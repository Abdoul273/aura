// Stockage SQLite : bibliothèque, favoris, historique d'écoute, playlists, radios, égaliseur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::*;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub struct Db {
    path: PathBuf,
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    mtime INTEGER NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album_artist TEXT NOT NULL,
    album TEXT NOT NULL,
    album_id TEXT NOT NULL,
    track_number INTEGER NOT NULL,
    disc_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    genre TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    codec TEXT NOT NULL,
    bitrate INTEGER NOT NULL,
    sample_rate INTEGER NOT NULL,
    bit_depth INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id);
CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    has_cover INTEGER NOT NULL,
    dominant TEXT NOT NULL,
    accent TEXT NOT NULL,
    muted TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
    track_id TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    listened_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_track ON plays(track_id);
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    cover_url TEXT
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    track_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS playlist_tracks_pl ON playlist_tracks(playlist_id, position);
CREATE TABLE IF NOT EXISTS radios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT NOT NULL,
    stream_url TEXT NOT NULL,
    homepage TEXT NOT NULL,
    bitrate INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eq_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bands TEXT NOT NULL,
    preamp REAL NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

const DEFAULT_RADIOS: &[(&str, &str, &str, &str, u32)] = &[
    ("FIP", "Éclectique", "https://icecast.radiofrance.fr/fip-hifi.aac", "https://www.radiofrance.fr/fip", 192),
    ("Radio Paradise (FLAC)", "Éclectique", "https://stream.radioparadise.com/flac", "https://radioparadise.com", 1411),
    ("SomaFM Groove Salad", "Ambient", "https://ice1.somafm.com/groovesalad-256-mp3", "https://somafm.com/groovesalad", 256),
    ("SomaFM Drone Zone", "Ambient", "https://ice1.somafm.com/dronezone-256-mp3", "https://somafm.com/dronezone", 256),
    ("France Inter", "Généraliste", "https://icecast.radiofrance.fr/franceinter-hifi.aac", "https://www.radiofrance.fr/franceinter", 192),
];

pub fn builtin_presets() -> Vec<EqPreset> {
    let p = |id: &str, name: &str, bands: [f64; 10], preamp: f64| EqPreset {
        id: id.into(),
        name: name.into(),
        bands: bands.to_vec(),
        preamp,
    };
    vec![
        p("flat", "Plat", [0.0; 10], 0.0),
        p("rock", "Rock", [4.0, 3.0, -1.0, -2.0, -1.0, 1.0, 3.0, 4.0, 4.0, 4.0], -3.0),
        p("bass", "Bass Boost", [7.0, 6.0, 5.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], -6.0),
        p("vocal", "Voix", [-2.0, -1.0, 0.0, 2.0, 4.0, 4.0, 3.0, 1.0, 0.0, -1.0], -3.0),
        p("electro", "Électronique", [5.0, 4.0, 1.0, 0.0, -1.0, 1.0, 0.0, 2.0, 4.0, 5.0], -4.0),
        p("classical", "Classique", [4.0, 3.0, 2.0, 1.0, -1.0, -1.0, 0.0, 2.0, 3.0, 4.0], -3.0),
        p("jazz", "Jazz", [3.0, 2.0, 1.0, 2.0, -1.0, -1.0, 0.0, 1.0, 2.0, 3.0], -2.0),
    ]
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Db> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        let db = Db { path: path.to_path_buf(), conn: Mutex::new(conn) };
        db.seed_radios()?;
        Ok(db)
    }

    /// Connexion séparée pour le scan (évite de bloquer l'UI pendant l'indexation).
    pub fn open_secondary(&self) -> rusqlite::Result<Connection> {
        let c = Connection::open(&self.path)?;
        c.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        Ok(c)
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn seed_radios(&self) -> rusqlite::Result<()> {
        let c = self.conn();
        let seeded: Option<String> =
            c.query_row("SELECT value FROM kv WHERE key = 'radios_seeded'", [], |r| r.get(0)).optional()?;
        if seeded.is_some() {
            return Ok(());
        }
        for (i, (name, genre, url, home, br)) in DEFAULT_RADIOS.iter().enumerate() {
            c.execute(
                "INSERT OR IGNORE INTO radios VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![format!("rd_default_{i}"), name, genre, url, home, br, now_ms() + i as i64],
            )?;
        }
        c.execute("INSERT INTO kv VALUES ('radios_seeded', '1')", [])?;
        Ok(())
    }

    // ---------- clé/valeur ----------

    pub fn kv_get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        let v: Option<String> = self
            .conn()
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        v.and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn kv_set<T: serde::Serialize>(&self, key: &str, value: &T) {
        if let Ok(s) = serde_json::to_string(value) {
            let _ = self.conn().execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, s],
            );
        }
    }

    // ---------- bibliothèque ----------

    pub fn snapshot_tracks(&self) -> rusqlite::Result<Vec<TrackRow>> {
        let c = self.conn();
        let mut stmt = c.prepare(
            "SELECT t.id, t.title, t.artist, t.album_artist, t.album, t.album_id, t.track_number, t.disc_number,
                    t.year, t.genre, t.duration_ms, t.codec, t.bitrate, t.sample_rate, t.bit_depth, t.path,
                    t.file_size, t.added_at,
                    (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id),
                    EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id)
             FROM tracks t",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TrackRow {
                id: r.get(0)?,
                title: r.get(1)?,
                artist: r.get(2)?,
                album_artist: r.get(3)?,
                album: r.get(4)?,
                album_id: r.get(5)?,
                track_number: r.get(6)?,
                disc_number: r.get(7)?,
                year: r.get(8)?,
                genre: r.get(9)?,
                duration_ms: r.get::<_, i64>(10)? as u64,
                codec: r.get(11)?,
                bitrate: r.get(12)?,
                sample_rate: r.get(13)?,
                bit_depth: r.get(14)?,
                file_path: r.get(15)?,
                file_size: r.get::<_, i64>(16)? as u64,
                added_at: r.get(17)?,
                plays: r.get(18)?,
                favorite: r.get(19)?,
            })
        })?;
        rows.collect()
    }

    pub fn snapshot_albums(&self) -> rusqlite::Result<Vec<AlbumMeta>> {
        let c = self.conn();
        let mut stmt = c.prepare("SELECT id, has_cover, dominant, accent, muted FROM albums")?;
        let rows = stmt.query_map([], |r| {
            Ok(AlbumMeta {
                id: r.get(0)?,
                has_cover: r.get(1)?,
                colors: AlbumColors { dominant: r.get(2)?, accent: r.get(3)?, muted: r.get(4)? },
            })
        })?;
        rows.collect()
    }

    /// Chemin + infos minimales pour la lecture et MPRIS.
    pub fn track_brief(&self, id: &str) -> Option<TrackBrief> {
        self.conn()
            .query_row(
                "SELECT path, title, artist, album, album_id, duration_ms FROM tracks WHERE id = ?1",
                [id],
                |r| {
                    Ok(TrackBrief {
                        path: r.get(0)?,
                        title: r.get(1)?,
                        artist: r.get(2)?,
                        album: r.get(3)?,
                        album_id: r.get(4)?,
                        duration_ms: r.get::<_, i64>(5)? as u64,
                    })
                },
            )
            .optional()
            .ok()
            .flatten()
    }

    // ---------- favoris ----------

    pub fn toggle_favorite(&self, track_id: &str) -> rusqlite::Result<bool> {
        let c = self.conn();
        let removed = c.execute("DELETE FROM favorites WHERE track_id = ?1", [track_id])?;
        if removed > 0 {
            return Ok(false);
        }
        c.execute("INSERT INTO favorites VALUES (?1, ?2)", params![track_id, now_ms()])?;
        Ok(true)
    }

    pub fn favorites(&self) -> rusqlite::Result<Vec<String>> {
        let c = self.conn();
        let mut stmt = c.prepare("SELECT track_id FROM favorites ORDER BY added_at DESC")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    // ---------- écoutes ----------

    pub fn record_play(&self, track_id: &str, started_at: i64, listened_ms: u64) {
        let _ = self.conn().execute(
            "INSERT INTO plays (track_id, started_at, listened_ms) VALUES (?1, ?2, ?3)",
            params![track_id, started_at, listened_ms as i64],
        );
    }

    pub fn play_stats(&self, tz_offset_min: i64) -> rusqlite::Result<PlayStats> {
        let c = self.conn();
        let mut stmt = c.prepare("SELECT track_id, started_at, listened_ms FROM plays")?;
        let rows: Vec<(String, i64, i64)> =
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;

        const DAY: i64 = 86_400_000;
        let offset = tz_offset_min * 60_000;
        let now = now_ms() + offset;
        let today = now.div_euclid(DAY);
        let mut by_day: HashMap<i64, u64> = HashMap::new();
        let mut hourly = vec![0u64; 24];
        let mut per_track: HashMap<String, u64> = HashMap::new();
        let (mut d0, mut d7, mut d30, mut all) = (0u64, 0u64, 0u64, 0u64);

        for (tid, started, ms) in rows {
            let ms = ms.max(0) as u64;
            let local = started + offset;
            let day = local.div_euclid(DAY);
            let age = today - day;
            all += ms;
            if age == 0 {
                d0 += ms;
            }
            if age < 7 {
                d7 += ms;
            }
            if age < 30 {
                d30 += ms;
            }
            *by_day.entry(day).or_default() += ms;
            hourly[(local.rem_euclid(DAY) / 3_600_000) as usize] += ms;
            *per_track.entry(tid).or_default() += ms;
        }

        // 53 semaines × 7 jours, le dernier élément = aujourd'hui.
        let n = 371i64;
        let max_day = by_day.values().copied().max().unwrap_or(0).max(1) as f64;
        let heatmap = (0..n)
            .map(|i| {
                let day = today - (n - 1 - i);
                by_day.get(&day).copied().unwrap_or(0) as f64 / max_day
            })
            .collect();
        let max_h = hourly.iter().copied().max().unwrap_or(0).max(1) as f64;
        let hourly_distribution = hourly.iter().map(|&h| h as f64 / max_h).collect();

        let mut streak = 0u32;
        let mut d = if by_day.contains_key(&today) { today } else { today - 1 };
        while by_day.get(&d).copied().unwrap_or(0) > 0 {
            streak += 1;
            d -= 1;
        }

        Ok(PlayStats {
            listened_ms_today: d0,
            listened_ms_week: d7,
            listened_ms_month: d30,
            listened_ms_all: all,
            streak_days: streak,
            heatmap,
            hourly_distribution,
            track_ms: per_track.into_iter().collect(),
        })
    }

    // ---------- playlists ----------

    pub fn playlists(&self) -> rusqlite::Result<Vec<Playlist>> {
        let c = self.conn();
        let mut stmt =
            c.prepare("SELECT id, name, description, created_at, updated_at, cover_url FROM playlists ORDER BY created_at")?;
        let mut lists: Vec<Playlist> = stmt
            .query_map([], |r| {
                Ok(Playlist {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    cover_url: r.get(5)?,
                    track_ids: vec![],
                    smart: false,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut tstmt = c.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?;
        for p in &mut lists {
            p.track_ids = tstmt.query_map([&p.id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        }
        Ok(lists)
    }

    pub fn playlist_create(&self, name: &str) -> rusqlite::Result<Playlist> {
        let now = now_ms();
        let id = format!("pl_{now}");
        self.conn().execute(
            "INSERT INTO playlists (id, name, description, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?3)",
            params![id, name, now],
        )?;
        Ok(Playlist {
            id,
            name: name.into(),
            description: String::new(),
            track_ids: vec![],
            created_at: now,
            updated_at: now,
            smart: false,
            cover_url: None,
        })
    }

    pub fn playlist_update(&self, id: &str, name: Option<&str>, description: Option<&str>, cover: Option<&str>) -> rusqlite::Result<()> {
        let c = self.conn();
        if let Some(n) = name {
            c.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, n])?;
        }
        if let Some(d) = description {
            c.execute("UPDATE playlists SET description = ?2 WHERE id = ?1", params![id, d])?;
        }
        if let Some(u) = cover {
            c.execute("UPDATE playlists SET cover_url = ?2 WHERE id = ?1", params![id, u])?;
        }
        c.execute("UPDATE playlists SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
        Ok(())
    }

    pub fn playlist_delete(&self, id: &str) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM playlists WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Remplace entièrement l'ordre des titres d'une playlist.
    pub fn playlist_set_tracks(&self, id: &str, track_ids: &[String]) -> rusqlite::Result<()> {
        let mut c = self.conn();
        let tx = c.transaction()?;
        tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
        {
            let mut ins = tx.prepare("INSERT INTO playlist_tracks VALUES (?1, ?2, ?3)")?;
            for (i, t) in track_ids.iter().enumerate() {
                ins.execute(params![id, i as i64, t])?;
            }
        }
        tx.execute("UPDATE playlists SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
        tx.commit()
    }

    pub fn playlist_tracks(&self, id: &str) -> rusqlite::Result<Vec<String>> {
        let c = self.conn();
        let mut stmt = c.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        rows.collect()
    }

    // ---------- radios ----------

    pub fn radios(&self) -> rusqlite::Result<Vec<RadioStation>> {
        let c = self.conn();
        let mut stmt =
            c.prepare("SELECT id, name, genre, stream_url, homepage, bitrate FROM radios ORDER BY created_at")?;
        let rows = stmt.query_map([], |r| {
            Ok(RadioStation {
                id: r.get(0)?,
                name: r.get(1)?,
                genre: r.get(2)?,
                stream_url: r.get(3)?,
                homepage: r.get(4)?,
                bitrate: r.get(5)?,
                live: true,
                now_playing: None,
            })
        })?;
        rows.collect()
    }

    pub fn radio_add(&self, name: &str, url: &str, genre: &str) -> rusqlite::Result<RadioStation> {
        let now = now_ms();
        let id = format!("rd_{now}");
        self.conn().execute(
            "INSERT INTO radios VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5)",
            params![id, name, genre, url, now],
        )?;
        Ok(RadioStation {
            id,
            name: name.into(),
            genre: genre.into(),
            stream_url: url.into(),
            homepage: url.into(),
            bitrate: 0,
            live: true,
            now_playing: None,
        })
    }

    pub fn radio_remove(&self, id: &str) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM radios WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---------- égaliseur ----------

    pub fn eq_presets(&self) -> rusqlite::Result<Vec<EqPreset>> {
        let c = self.conn();
        let mut stmt = c.prepare("SELECT id, name, bands, preamp FROM eq_presets ORDER BY created_at")?;
        let custom = stmt
            .query_map([], |r| {
                let bands: String = r.get(2)?;
                Ok(EqPreset {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    bands: serde_json::from_str(&bands).unwrap_or_else(|_| vec![0.0; 10]),
                    preamp: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut all = builtin_presets();
        all.extend(custom);
        Ok(all)
    }

    pub fn eq_preset_save(&self, name: &str, bands: &[f64], preamp: f64) -> rusqlite::Result<EqPreset> {
        let now = now_ms();
        let id = format!("eq_{now}");
        self.conn().execute(
            "INSERT INTO eq_presets VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, serde_json::to_string(bands).unwrap_or_default(), preamp, now],
        )?;
        Ok(EqPreset { id, name: name.into(), bands: bands.to_vec(), preamp })
    }
}

pub struct TrackBrief {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_id: String,
    pub duration_ms: u64,
}
