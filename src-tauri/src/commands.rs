// Commandes Tauri appelées par `src/services/tauriBackend.ts`.
// Toutes asynchrones : elles ne s'exécutent jamais sur le thread de l'interface.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use lofty::config::WriteOptions;

use crate::db::Db;
use crate::models::*;
use crate::player::Player;
use crate::settings::SettingsStore;
use crate::visualizer::Visualizer;
use crate::download::{DlJob, DlResult, Downloader};
use crate::{backup, lyrics, scanner};

pub struct AppState {
    pub db: Arc<Db>,
    pub settings: Arc<SettingsStore>,
    pub player: Arc<Player>,
    pub visualizer: Visualizer,
    pub cover_dir: PathBuf,
    pub lyrics_dir: PathBuf,
    pub scanning: AtomicBool,
    pub downloader: Arc<Downloader>,
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPatch {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    genre: String,
    year: u32,
    track_number: u32,
    disc_number: u32,
}

#[tauri::command]
pub async fn library_update_tags(app: AppHandle, st: S<'_>, track_id: String, patch: TagPatch) -> Res<()> {
    if st.scanning.load(Ordering::SeqCst) {
        return Err("Attendez la fin du scan avant de modifier les tags".into());
    }
    if patch.title.trim().is_empty() || patch.artist.trim().is_empty() || patch.album.trim().is_empty() {
        return Err("Le titre, l'artiste et l'album sont obligatoires".into());
    }
    let path = st.db.track_brief(&track_id).ok_or("Titre introuvable")?.path;
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tagged = Probe::open(&path).map_err(err)?.read().map_err(err)?;
        if tagged.primary_tag().is_none() {
            tagged.insert_tag(Tag::new(tagged.primary_tag_type()));
        }
        let tag = tagged.primary_tag_mut().ok_or("Tags non pris en charge")?;
        tag.set_title(patch.title.trim().to_owned());
        tag.set_artist(patch.artist.trim().to_owned());
        tag.set_album(patch.album.trim().to_owned());
        tag.insert_text(ItemKey::AlbumArtist, patch.album_artist.trim().to_owned());
        tag.insert_text(ItemKey::Genre, patch.genre.trim().to_owned());
        tag.insert_text(ItemKey::Year, patch.year.to_string());
        tag.insert_text(ItemKey::TrackNumber, patch.track_number.to_string());
        tag.insert_text(ItemKey::DiscNumber, patch.disc_number.max(1).to_string());
        tagged.save_to_path(&path, WriteOptions::default()).map_err(err)?;
        run_scan(&app, &st)
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn library_set_cover(app: AppHandle, st: S<'_>, album_id: String, path: String) -> Res<()> {
    if !st.db.snapshot_albums().map_err(err)?.iter().any(|a| a.id == album_id) {
        return Err("Album introuvable".into());
    }
    let colors = scanner::import_cover(std::path::Path::new(&path), &st.cover_dir.join(format!("{album_id}.jpg")))?;
    st.db.set_album_cover(&album_id, &colors).map_err(err)?;
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn lyrics_search_library(st: S<'_>, query: String) -> Res<Vec<String>> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || lyrics::search_library(&st.db, &st.lyrics_dir, &query)).await.map_err(err)
}

#[tauri::command]
pub async fn system_create_backup(st: S<'_>, directory: String) -> Res<String> {
    let settings = serde_json::to_string_pretty(&st.settings.get()).map_err(err)?;
    let db = st.db.clone();
    let covers = st.cover_dir.clone();
    let folder = std::path::PathBuf::from(directory);
    let path = tauri::async_runtime::spawn_blocking(move || backup::create(&db, &settings, &covers, &folder)).await.map_err(err)??;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn system_prepare_restore(app: AppHandle, directory: String) -> Res<()> {
    let config = app.path().app_config_dir().map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || backup::prepare_restore(std::path::Path::new(&directory), &config)).await.map_err(err)?
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

// ---------- téléchargement ----------

#[tauri::command]
pub async fn download_search(st: S<'_>, query: String) -> Res<Vec<DlResult>> {
    let d = st.downloader.clone();
    tauri::async_runtime::spawn_blocking(move || d.search(&query)).await.map_err(err)?
}

#[tauri::command]
pub async fn download_probe(st: S<'_>, id: String, artist: String, track: String, duration_s: f64) -> Res<String> {
    let d = st.downloader.clone();
    tauri::async_runtime::spawn_blocking(move || d.probe(&id, &artist, &track, duration_s)).await.map_err(err)
}

#[tauri::command]
pub async fn download_start(app: AppHandle, st: S<'_>, result: DlResult) -> Res<DlJob> {
    Ok(st.downloader.start(app, result))
}

#[tauri::command]
pub async fn download_cancel(app: AppHandle, st: S<'_>, id: String) -> Res<()> {
    st.downloader.cancel(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn download_list(st: S<'_>) -> Res<Vec<DlJob>> {
    Ok(st.downloader.list())
}

#[tauri::command]
pub async fn download_clear(st: S<'_>) -> Res<()> {
    st.downloader.clear_finished();
    Ok(())
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
    st.player.set_crossfade(ms)
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
    st.db.remove_folder_tracks(std::path::Path::new(&path)).map_err(err)?;
    let _ = app.emit("library:changed", ());
    spawn_scan(&app);
    Ok(())
}

// ---------- fenêtre ----------

/// Bascule le mini-lecteur : fenêtre compacte, flottante et épinglée (Hyprland) ou toujours au premier plan.
#[tauri::command]
pub async fn window_set_mini(app: AppHandle, mini: bool) -> Res<()> {
    let w = app.get_webview_window("main").ok_or("fenêtre introuvable")?;
    let hypr = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some();
    // Cible la fenêtre d'Aura par PID : la fenêtre active n'est pas forcément la nôtre.
    let me = format!("pid:{}", std::process::id());
    let hyprctl = |batch: String| {
        let _ = std::process::Command::new("hyprctl").args(["--batch", &batch]).output();
    };
    if mini {
        let _ = w.set_min_size(None::<tauri::LogicalSize<f64>>);
        if hypr {
            hyprctl(format!(
                "dispatch setfloating {me} ; dispatch resizewindowpixel exact 460 168,{me} ; dispatch movewindowpixel exact 70% 4%,{me} ; dispatch pin {me}"
            ));
        } else {
            let _ = w.set_size(tauri::LogicalSize::new(460.0, 168.0));
        }
        let _ = w.set_always_on_top(true);
    } else {
        let _ = w.set_always_on_top(false);
        if hypr {
            hyprctl(format!("dispatch pin {me} ; dispatch settiled {me}"));
        } else {
            let _ = w.set_size(tauri::LogicalSize::new(1440.0, 900.0));
        }
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(900.0, 600.0)));
    }
    Ok(())
}
