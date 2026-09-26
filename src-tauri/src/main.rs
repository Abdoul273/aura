// Aura — point d'entrée Tauri : initialise la base, mpv, MPRIS et lance un scan incrémental.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod lyrics;
mod models;
mod mpv;
mod player;
mod scanner;
mod settings;
mod visualizer;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{Manager, RunEvent};

use commands::*;

fn main() {
    // WebKitGTK + Wayland : le rendu DMA-BUF donne des fenêtres noires sur plusieurs pilotes.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = app.path();
            let data_dir = paths.app_data_dir()?;
            let config_dir = paths.app_config_dir()?;
            let cache_dir = paths.app_cache_dir()?;
            for d in [&data_dir, &config_dir, &cache_dir] {
                std::fs::create_dir_all(d)?;
            }
            let cover_dir = cache_dir.join("covers");
            std::fs::create_dir_all(&cover_dir)?;
            let _ = app.asset_protocol_scope().allow_directory(&cover_dir, true);

            let db = Arc::new(db::Db::open(&data_dir.join("aura.db"))?);
            let settings = Arc::new(settings::SettingsStore::load(config_dir.join("settings.json")));
            let socket = dirs::runtime_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(format!("aura-mpv-{}.sock", std::process::id()));
            let player = player::Player::start(app.handle().clone(), db.clone(), settings.clone(), cover_dir.clone(), socket)?;

            app.manage(Arc::new(AppState {
                db,
                settings,
                player,
                visualizer: visualizer::Visualizer::new(),
                cover_dir,
                lyrics_dir: cache_dir.join("lyrics"),
                scanning: AtomicBool::new(false),
            }));

            // Scan incrémental au démarrage (seuls les fichiers nouveaux ou modifiés sont relus).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let st = handle.state::<Arc<AppState>>().inner().clone();
                let _ = run_scan(&handle, &st);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_snapshot,
            library_rescan,
            library_is_scanning,
            favorites_toggle,
            favorites_list,
            stats_plays,
            lyrics_get,
            lyrics_search,
            lyrics_choose,
            player_state,
            player_play,
            player_pause,
            player_resume,
            player_next,
            player_previous,
            player_seek,
            player_set_volume,
            player_set_muted,
            player_set_shuffle,
            player_set_repeat,
            queue_add,
            queue_remove,
            queue_move,
            queue_clear,
            playlists_list,
            playlist_create,
            playlist_update,
            playlist_delete,
            playlist_add_tracks,
            playlist_remove_tracks,
            playlist_reorder,
            audio_devices,
            audio_set_device,
            audio_output_status,
            eq_get,
            eq_set,
            eq_presets,
            eq_preset_save,
            audio_set_gapless,
            audio_set_replay_gain,
            audio_set_crossfade,
            visualizer_start,
            visualizer_stop,
            radio_list,
            radio_add,
            radio_remove,
            radio_play,
            settings_get,
            settings_update,
            settings_add_folder,
            settings_remove_folder,
            window_set_mini,
        ])
        .build(tauri::generate_context!())
        .expect("impossible de démarrer Aura");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(st) = handle.try_state::<Arc<AppState>>() {
                st.visualizer.stop();
                st.player.shutdown();
            }
        }
    });
}
