// Commandes Tauri appelées par `src/services/tauriBackend.ts`.
// Toutes asynchrones : elles ne s'exécutent jamais sur le thread de l'interface.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Db;
use crate::models::*;
use crate::player::Player;
use crate::settings::SettingsStore;
use crate::visualizer::Visualizer;
use crate::{lyrics, scanner};

pub struct AppState {
    pub db: Arc<Db>,
    pub settings: Arc<SettingsStore>,
    pub player: Arc<Player>,
    pub visualizer: Visualizer,
    pub cover_dir: PathBuf,
    pub lyrics_dir: PathBuf,
    pub scanning: AtomicBool,
}

type Res<T> = Result<T, String>;
type S<'a> = State<'a, Arc<AppState>>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Lance un scan (un seul à la fois) ; `library:changed` est émis s'il y a du nouveau.
pub fn run_scan(app: &AppHandle, st: &AppState) -> Res<()> {
    if st.scanning.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let folders = st.settings.get().music_folders;
    let res = st.db.open_secondary().map_err(err).and_then(|mut conn| {
        scanner::scan(&mut conn, &folders, &st.cover_dir, &|p| {
            let _ = app.emit("library:scan", &p);
        })
        .map_err(err)
    });
    st.scanning.store(false, Ordering::SeqCst);
    if res.as_ref().map(|o| o.changed).unwrap_or(false) {
        let _ = app.emit("library:changed", ());
    }
    res.map(|_| ())
}

fn spawn_scan(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Arc<AppState>>().inner().clone();
        let _ = run_scan(&app, &st);
    });
}

// ---------- bibliothèque ----------

#[tauri::command]
pub async fn library_snapshot(st: S<'_>) -> Res<Snapshot> {
    Ok(Snapshot {
        tracks: st.db.snapshot_tracks().map_err(err)?,
        albums: st.db.snapshot_albums().map_err(err)?,
        cover_dir: st.cover_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn library_rescan(app: AppHandle, st: S<'_>) -> Res<()> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_scan(&app, &st)).await.map_err(err)?
}

#[tauri::command]
pub async fn library_is_scanning(st: S<'_>) -> Res<bool> {
    Ok(st.scanning.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn favorites_toggle(st: S<'_>, track_id: String) -> Res<bool> {
    st.db.toggle_favorite(&track_id).map_err(err)
}

#[tauri::command]
pub async fn favorites_list(st: S<'_>) -> Res<Vec<String>> {
    st.db.favorites().map_err(err)
}

#[tauri::command]
pub async fn stats_plays(st: S<'_>, tz_offset_min: i64) -> Res<PlayStats> {
    st.db.play_stats(tz_offset_min).map_err(err)
}

#[tauri::command]
pub async fn lyrics_get(st: S<'_>, track_id: String, force: Option<bool>) -> Res<Option<Lyrics>> {
    let st = st.inner().clone();
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || lyrics::get(&st.db, &st.lyrics_dir, &track_id, force)).await.map_err(err)
}

#[tauri::command]
pub async fn lyrics_search(st: S<'_>, track_id: String, query: Option<String>) -> Res<Option<LyricsSearch>> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || lyrics::search(&st.db, &track_id, query)).await.map_err(err)
}

#[tauri::command]
pub async fn lyrics_choose(st: S<'_>, track_id: String, text: String, source: String, duration_s: f64) -> Res<Option<Lyrics>> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || lyrics::choose(&st.db, &st.lyrics_dir, &track_id, &text, &source, duration_s)).await.map_err(err)
}

// ---------- lecture ----------

#[tauri::command]
pub async fn player_state(st: S<'_>) -> Res<PlayerState> {
    Ok(st.player.state())
}

#[tauri::command]
pub async fn player_play(st: S<'_>, track_ids: Vec<String>, start_index: usize) -> Res<()> {
    st.player.play(track_ids, start_index);
    Ok(())
}

#[tauri::command]
pub async fn player_pause(st: S<'_>) -> Res<()> {
    st.player.pause();
    Ok(())
}

#[tauri::command]
pub async fn player_resume(st: S<'_>) -> Res<()> {
    st.player.resume();
    Ok(())
}

#[tauri::command]
pub async fn player_next(st: S<'_>) -> Res<()> {
    st.player.next();
    Ok(())
}

#[tauri::command]
pub async fn player_previous(st: S<'_>) -> Res<()> {
    st.player.previous();
    Ok(())
}

#[tauri::command]
pub async fn player_seek(st: S<'_>, ms: f64) -> Res<()> {
    st.player.seek(ms.max(0.0) as u64);
    Ok(())
}

#[tauri::command]
pub async fn player_set_volume(st: S<'_>, volume: f64) -> Res<()> {
    st.player.set_volume(volume);
    Ok(())
}

#[tauri::command]
pub async fn player_set_muted(st: S<'_>, muted: bool) -> Res<()> {
    st.player.set_muted(muted);
    Ok(())
}

#[tauri::command]
pub async fn player_set_shuffle(st: S<'_>, shuffle: bool) -> Res<()> {
    st.player.set_shuffle(shuffle);
    Ok(())
}

#[tauri::command]
pub async fn player_set_repeat(st: S<'_>, mode: String) -> Res<()> {
    st.player.set_repeat(mode);
    Ok(())
}

#[tauri::command]
pub async fn queue_add(st: S<'_>, track_ids: Vec<String>, position: String) -> Res<()> {
    st.player.queue_add(track_ids, position == "next");
    Ok(())
}

#[tauri::command]
pub async fn queue_remove(st: S<'_>, index: usize) -> Res<()> {
    st.player.queue_remove(index);
    Ok(())
}

#[tauri::command]
pub async fn queue_move(st: S<'_>, from: usize, to: usize) -> Res<()> {
    st.player.queue_move(from, to);
    Ok(())
}

#[tauri::command]
pub async fn queue_clear(st: S<'_>) -> Res<()> {
    st.player.queue_clear();
    Ok(())
}

// ---------- playlists ----------

#[tauri::command]
pub async fn playlists_list(st: S<'_>) -> Res<Vec<Playlist>> {
    st.db.playlists().map_err(err)
}

#[tauri::command]
pub async fn playlist_create(st: S<'_>, name: String) -> Res<Playlist> {
    st.db.playlist_create(&name).map_err(err)
}

#[tauri::command]
pub async fn playlist_update(st: S<'_>, id: String, name: Option<String>, description: Option<String>, cover_url: Option<String>) -> Res<()> {
    st.db.playlist_update(&id, name.as_deref(), description.as_deref(), cover_url.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn playlist_delete(st: S<'_>, id: String) -> Res<()> {
    st.db.playlist_delete(&id).map_err(err)
}

#[tauri::command]
pub async fn playlist_add_tracks(st: S<'_>, id: String, track_ids: Vec<String>) -> Res<()> {
    let mut cur = st.db.playlist_tracks(&id).map_err(err)?;
    for t in track_ids {
        if !cur.contains(&t) {
            cur.push(t);
        }
    }
    st.db.playlist_set_tracks(&id, &cur).map_err(err)
}

#[tauri::command]
pub async fn playlist_remove_tracks(st: S<'_>, id: String, track_ids: Vec<String>) -> Res<()> {
    let cur: Vec<String> = st.db.playlist_tracks(&id).map_err(err)?.into_iter().filter(|t| !track_ids.contains(t)).collect();
    st.db.playlist_set_tracks(&id, &cur).map_err(err)
}

#[tauri::command]
pub async fn playlist_reorder(st: S<'_>, id: String, from: usize, to: usize) -> Res<()> {
    let mut cur = st.db.playlist_tracks(&id).map_err(err)?;
    if from < cur.len() && to < cur.len() {
        let t = cur.remove(from);
        cur.insert(to, t);
        st.db.playlist_set_tracks(&id, &cur).map_err(err)?;
    }
    Ok(())
}

// ---------- audio ----------

#[tauri::command]
pub async fn audio_devices(st: S<'_>) -> Res<Vec<AudioDevice>> {
    Ok(st.player.devices())
}

#[tauri::command]
pub async fn audio_set_device(st: S<'_>, id: String) -> Res<()> {
    st.player.set_device(id);
    Ok(())
}

#[tauri::command]
pub async fn audio_output_status(st: S<'_>) -> Res<OutputStatus> {
    Ok(st.player.output_status())
}

#[tauri::command]
pub async fn eq_get(st: S<'_>) -> Res<EqState> {
    Ok(st.player.eq())
}

#[tauri::command]
pub async fn eq_set(st: S<'_>, bands: Vec<f64>, preamp: f64, enabled: bool) -> Res<()> {
    st.player.set_eq(EqState { bands, preamp, enabled });
    Ok(())
}

#[tauri::command]
pub async fn eq_presets(st: S<'_>) -> Res<Vec<EqPreset>> {
    st.db.eq_presets().map_err(err)
}

#[tauri::command]
pub async fn eq_preset_save(st: S<'_>, name: String, bands: Vec<f64>, preamp: f64) -> Res<EqPreset> {
    st.db.eq_preset_save(&name, &bands, preamp).map_err(err)
}

#[tauri::command]
pub async fn audio_set_gapless(st: S<'_>, on: bool) -> Res<()> {
    st.player.set_gapless(on);
    st.settings.modify(|s| s.gapless = on);
    Ok(())
}

#[tauri::command]
pub async fn audio_set_replay_gain(st: S<'_>, mode: String) -> Res<()> {
    st.settings.modify(|s| s.replay_gain = mode.clone());
    st.player.set_replay_gain(mode);
    Ok(())
}

#[tauri::command]
pub async fn audio_set_crossfade(st: S<'_>, ms: u64) -> Res<()> {
    st.settings.modify(|s| s.crossfade_ms = ms);
    Ok(())
}

#[tauri::command]
pub async fn visualizer_start(app: AppHandle, st: S<'_>) -> Res<()> {
    st.visualizer.start(app)
}

#[tauri::command]
pub async fn visualizer_stop(st: S<'_>) -> Res<()> {
    st.visualizer.stop();
    Ok(())
}

// ---------- radios ----------

#[tauri::command]
pub async fn radio_list(st: S<'_>) -> Res<Vec<RadioStation>> {
    let mut list = st.db.radios().map_err(err)?;
    let (rid, title) = st.player.radio_now_playing();
    if let (Some(rid), Some(title)) = (rid, title) {
        if let Some(r) = list.iter_mut().find(|r| r.id == rid) {
            r.now_playing = Some(title);
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn radio_add(st: S<'_>, name: String, url: String, genre: String) -> Res<RadioStation> {
    st.db.radio_add(&name, &url, &genre).map_err(err)
}

#[tauri::command]
pub async fn radio_remove(st: S<'_>, id: String) -> Res<()> {
    st.db.radio_remove(&id).map_err(err)
}

#[tauri::command]
pub async fn radio_play(st: S<'_>, id: String) -> Res<()> {
    let station = st.db.radios().map_err(err)?.into_iter().find(|r| r.id == id).ok_or("Radio introuvable")?;
    st.player.play_radio(&station);
    Ok(())
}

// ---------- paramètres ----------

#[tauri::command]
pub async fn settings_get(st: S<'_>) -> Res<Settings> {
    Ok(st.settings.get())
}

#[tauri::command]
pub async fn settings_update(st: S<'_>, patch: Value) -> Res<Settings> {
    Ok(st.settings.update(patch))
}

#[tauri::command]
pub async fn settings_add_folder(app: AppHandle, st: S<'_>, path: String) -> Res<()> {
    let p = path.trim_end_matches('/').to_string();
    if !std::path::Path::new(&p).is_dir() {
        return Err(format!("Dossier introuvable : {p}"));
    }
    st.settings.modify(|s| {
        if !s.music_folders.contains(&p) {
            s.music_folders.push(p.clone());
        }
    });
    spawn_scan(&app);
    Ok(())
}

#[tauri::command]
pub async fn settings_remove_folder(app: AppHandle, st: S<'_>, path: String) -> Res<()> {
    st.settings.modify(|s| s.music_folders.retain(|f| f != &path));
    spawn_scan(&app);
    Ok(())
}

// ---------- fenêtre ----------

/// Bascule le mini-lecteur : fenêtre compacte, flottante et épinglée (Hyprland) ou toujours au premier plan.
#[tauri::command]
pub async fn window_set_mini(app: AppHandle, mini: bool) -> Res<()> {
    let w = app.get_webview_window("main").ok_or("fenêtre introuvable")?;
    let hypr = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some();
    if mini {
        let _ = w.set_min_size(None::<tauri::LogicalSize<f64>>);
        if hypr {
            let _ = std::process::Command::new("hyprctl")
                .args(["--batch", "dispatch setfloating ; dispatch resizeactive exact 400 150 ; dispatch pin"])
                .output();
        } else {
            let _ = w.set_size(tauri::LogicalSize::new(400.0, 150.0));
        }
        let _ = w.set_always_on_top(true);
    } else {
        let _ = w.set_always_on_top(false);
        if hypr {
            let _ = std::process::Command::new("hyprctl").args(["--batch", "dispatch pin ; dispatch settiled"]).output();
        } else {
            let _ = w.set_size(tauri::LogicalSize::new(1440.0, 900.0));
        }
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(900.0, 600.0)));
    }
    Ok(())
}
