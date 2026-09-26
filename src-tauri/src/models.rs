// Types échangés avec le frontend. Ils reflètent `src/types.ts` (camelCase côté JS).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AlbumColors {
    pub dominant: String,
    pub accent: String,
    pub muted: String,
}

/// Ligne brute d'un titre ; le frontend en dérive albums et artistes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRow {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub album_id: String,
    pub track_number: u32,
    pub disc_number: u32,
    pub year: u32,
    pub genre: String,
    pub duration_ms: u64,
    pub codec: String,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: u32,
    pub file_path: String,
    pub file_size: u64,
    pub added_at: i64,
    pub plays: u32,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumMeta {
    pub id: String,
    pub has_cover: bool,
    pub colors: AlbumColors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub uid: String,
    pub track_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub status: String,
    pub current_track_id: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f64,
    pub muted: bool,
    pub shuffle: bool,
    pub repeat: String,
    pub queue: Vec<QueueItem>,
    pub queue_index: i64,
    pub history: Vec<String>,
    pub radio_id: Option<String>,
    /// Titre diffusé par la radio en cours (métadonnées ICY).
    pub radio_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub key: String,
    pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub dynamic_color: bool,
    pub blur_intensity: f64,
    pub animations: bool,
    pub sidebar_collapsed: bool,
    pub drawer_open: bool,
    pub drawer_tab: String,
    pub tracks_sort: SortSpec,
    pub crossfade_ms: u64,
    pub gapless: bool,
    pub replay_gain: String,
    pub music_folders: Vec<String>,
    // Hors contrat TS : état audio persistant.
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(default)]
    pub audio_device: String,
}

fn default_volume() -> f64 {
    0.8
}

impl Default for Settings {
    fn default() -> Self {
        let music = dirs::audio_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Musique")))
            .map(|p| p.to_string_lossy().into_owned());
        Settings {
            theme: "dark".into(),
            accent: "#7c5cff".into(),
            dynamic_color: true,
            blur_intensity: 65.0,
            animations: true,
            sidebar_collapsed: false,
            drawer_open: false,
            drawer_tab: "queue".into(),
            tracks_sort: SortSpec { key: "title".into(), dir: "asc".into() },
            crossfade_ms: 0,
            gapless: true,
            replay_gain: "off".into(),
            music_folders: music.into_iter().collect(),
            volume: default_volume(),
            audio_device: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub track_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub smart: bool,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioStation {
    pub id: String,
    pub name: String,
    pub genre: String,
    pub stream_url: String,
    pub homepage: String,
    pub bitrate: u32,
    pub live: bool,
    pub now_playing: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EqPreset {
    pub id: String,
    pub name: String,
    pub bands: Vec<f64>,
    pub preamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqState {
    pub bands: Vec<f64>,
    pub preamp: f64,
    pub enabled: bool,
}

impl Default for EqState {
    fn default() -> Self {
        EqState { bands: vec![0.0; 10], preamp: 0.0, enabled: false }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub active: bool,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    pub driver: String,
    pub device_name: String,
    pub bit_perfect: bool,
    pub exclusive: bool,
    pub sample_rate: u32,
    pub bit_depth: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanning: bool,
    pub current: usize,
    pub total: usize,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub time_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Lyrics {
    /// `approximate` : paroles d'une version de durée différente (clip…), le décalage peut être à régler.
    Synced { lines: Vec<LyricsLine>, source: String, approximate: bool },
    Plain { text: String, source: String },
    Instrumental { source: String },
}

/// Résultat de la recherche manuelle de paroles.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_s: f64,
    pub source: String,
    pub synced: bool,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearch {
    pub query: String,
    pub results: Vec<LyricsResult>,
}

/// Agrégats d'écoute ; le frontend les complète avec les données de la bibliothèque.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayStats {
    pub listened_ms_today: u64,
    pub listened_ms_week: u64,
    pub listened_ms_month: u64,
    pub listened_ms_all: u64,
    pub streak_days: u32,
    pub heatmap: Vec<f64>,
    pub hourly_distribution: Vec<f64>,
    /// (trackId, listenedMs)
    pub track_ms: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub tracks: Vec<TrackRow>,
    pub albums: Vec<AlbumMeta>,
    pub cover_dir: String,
}
