// Paroles : fichier .lrc à côté du morceau → tag intégré → lrclib.net (mis en cache).

use std::path::Path;
use std::time::Duration;

use lofty::prelude::*;
use serde_json::Value;

use crate::db::Db;
use crate::models::{Lyrics, LyricsLine};

pub fn get(db: &Db, cache_dir: &Path, track_id: &str) -> Option<Lyrics> {
    let brief = db.track_brief(track_id)?;
    let path = Path::new(&brief.path);

    // 1. Fichier .lrc / .txt voisin.
    for ext in ["lrc", "LRC", "txt"] {
        if let Ok(text) = std::fs::read_to_string(path.with_extension(ext)) {
            if let Some(l) = from_text(&text) {
                return Some(l);
            }
        }
    }

    // 2. Tag intégré (USLT, LYRICS…).
    if let Ok(tagged) = lofty::read_from_path(path) {
        for tag in tagged.tags() {
            if let Some(text) = tag.get_string(ItemKey::Lyrics) {
                if let Some(l) = from_text(text) {
                    return Some(l);
                }
            }
        }
    }

    // 3. Cache puis lrclib.net.
    let _ = std::fs::create_dir_all(cache_dir);
    let cached = cache_dir.join(format!("{track_id}.lrc"));
    if let Ok(text) = std::fs::read_to_string(&cached) {
        return from_text(&text);
    }
    let none_marker = cache_dir.join(format!("{track_id}.none"));
    if none_marker.exists() || brief.artist == "Artiste inconnu" {
        return None;
    }
    match fetch_lrclib(&brief.title, &brief.artist, &brief.album, brief.duration_ms) {
        Ok(Some(text)) => {
            let _ = std::fs::write(&cached, &text);
            from_text(&text)
        }
        Ok(None) => {
            let _ = std::fs::write(&none_marker, "");
            None
        }
        Err(_) => None, // réseau indisponible : on réessaiera plus tard
    }
}

fn fetch_lrclib(title: &str, artist: &str, album: &str, duration_ms: u64) -> Result<Option<String>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .user_agent("Aura/0.1 (https://github.com/Abdoul273/aura)")
        .build()
        .into();

    let pick = |v: &Value| -> Option<String> {
        v["syncedLyrics"].as_str().or(v["plainLyrics"].as_str()).map(String::from).filter(|s| !s.trim().is_empty())
    };

    let mut resp = agent
        .get("https://lrclib.net/api/get")
        .query("track_name", title)
        .query("artist_name", artist)
        .query("album_name", album)
        .query("duration", (duration_ms / 1000).to_string())
        .call()
        .map_err(|e| e.to_string())?;
    if resp.status() == 200 {
        let v: Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
        if let Some(t) = pick(&v) {
            return Ok(Some(t));
        }
    }

    // Recherche plus souple si la correspondance exacte échoue.
    let mut resp = agent
        .get("https://lrclib.net/api/search")
        .query("track_name", title)
        .query("artist_name", artist)
        .call()
        .map_err(|e| e.to_string())?;
    if resp.status() != 200 {
        return Ok(None);
    }
    let v: Value = resp.body_mut().read_json().map_err(|e| e.to_string())?;
    let best = v.as_array().and_then(|a| {
        a.iter()
            .filter(|x| pick(x).is_some())
            .min_by_key(|x| ((x["duration"].as_f64().unwrap_or(0.0) * 1000.0) as i64 - duration_ms as i64).abs())
            .and_then(pick)
    });
    Ok(best)
}

/// Texte LRC synchronisé ou paroles brutes.
pub fn from_text(text: &str) -> Option<Lyrics> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return None;
    }
    let mut lines = Vec::new();
    let mut offset_ms: i64 = 0;
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut stamps = Vec::new();
        while rest.starts_with('[') {
            let Some(end) = rest.find(']') else { break };
            let tag = &rest[1..end];
            if let Some(off) = tag.strip_prefix("offset:") {
                offset_ms = off.trim().parse().unwrap_or(0);
            } else if let Some(ms) = parse_stamp(tag) {
                stamps.push(ms);
            }
            rest = rest[end + 1..].trim_start();
        }
        for ms in stamps {
            lines.push(LyricsLine { time_ms: (ms - offset_ms).max(0) as u64, text: rest.to_string() });
        }
    }
    if lines.is_empty() {
        return Some(Lyrics::Plain { text: text.trim().to_string() });
    }
    lines.sort_by_key(|l| l.time_ms);
    Some(Lyrics::Synced { lines })
}

fn parse_stamp(tag: &str) -> Option<i64> {
    let (m, s) = tag.split_once(':')?;
    let m: i64 = m.trim().parse().ok()?;
    let s: f64 = s.trim().replace(',', ".").parse().ok()?;
    Some(m * 60_000 + (s * 1000.0).round() as i64)
}
