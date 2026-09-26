// Indexation des dossiers de musique : tags (lofty), pochettes et palettes de couleurs.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Instant, UNIX_EPOCH};

use image::{DynamicImage, GenericImageView};
use lofty::file::FileType;
use lofty::picture::PictureType;
use lofty::prelude::*;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use walkdir::WalkDir;

use crate::db::now_ms;
use crate::models::{AlbumColors, ScanProgress};

const AUDIO_EXT: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "aif", "aiff", "wv", "ape", "mpc"];
const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album", "albumart"];
const COVER_SIZE: u32 = 600;

pub fn fnv1a(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub fn album_id(album_artist: &str, album: &str) -> String {
    format!("al_{}", fnv1a(&format!("{}\u{1}{}", album_artist.to_lowercase(), album.to_lowercase())))
}

struct ScannedTrack {
    path: String,
    mtime: i64,
    title: String,
    artist: String,
    album_artist: String,
    album: String,
    track_number: u32,
    disc_number: u32,
    year: u32,
    genre: String,
    duration_ms: u64,
    codec: String,
    bitrate: u32,
    sample_rate: u32,
    bit_depth: u32,
    file_size: u64,
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn mtime_of(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// "06_-_Mon_titre" → "Mon titre" quand le fichier n'a pas de tag titre.
fn title_from_filename(p: &Path) -> String {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("Sans titre").replace('_', " ");
    // Numéro de piste seulement s'il est suivi d'un séparateur (« 2Pac - … » reste entier).
    let digits = stem.len() - stem.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    let numbered = digits > 0 && stem[digits..].starts_with([' ', '-', '.']);
    let trimmed = if numbered { stem[digits..].trim_start_matches(['-', '.', ' ']).trim() } else { stem.trim() };
    if trimmed.is_empty() { stem.trim().to_string() } else { trimmed.to_string() }
}

fn parse_year(s: &str) -> u32 {
    s.chars().take(4).collect::<String>().parse().unwrap_or(0)
}

fn read_track(path: &Path, meta: &std::fs::Metadata) -> Option<ScannedTrack> {
    let tagged = lofty::read_from_path(path).ok()?;
    let props = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let get = |k: ItemKey| tag.and_then(|t| t.get_string(k)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let title = get(ItemKey::TrackTitle).unwrap_or_else(|| title_from_filename(path));
    let artist = get(ItemKey::TrackArtist).unwrap_or_else(|| "Artiste inconnu".into());
    let album_artist = get(ItemKey::AlbumArtist).unwrap_or_else(|| artist.clone());
    let album = get(ItemKey::AlbumTitle).unwrap_or_else(|| "Album inconnu".into());
    let genre = get(ItemKey::Genre).unwrap_or_default();
    let year = get(ItemKey::Year)
        .or_else(|| get(ItemKey::RecordingDate))
        .or_else(|| get(ItemKey::OriginalReleaseDate))
        .map(|s| parse_year(&s))
        .unwrap_or(0);
    let num = |k: ItemKey| get(k).and_then(|s| s.split('/').next().and_then(|n| n.trim().parse().ok())).unwrap_or(0);

    let bit_depth = props.bit_depth().map(|b| b as u32).unwrap_or(0);
    let codec = match tagged.file_type() {
        FileType::Flac => "FLAC",
        FileType::Mpeg => "MP3",
        FileType::Opus => "OPUS",
        FileType::Vorbis => "VORBIS",
        FileType::Mp4 => if bit_depth > 0 { "ALAC" } else { "AAC" },
        FileType::Wav => "WAV",
        FileType::Aiff => "AIFF",
        FileType::WavPack => "WAVPACK",
        FileType::Ape => "APE",
        FileType::Mpc => "MPC",
        _ => "AUDIO",
    };

    Some(ScannedTrack {
        path: path.to_string_lossy().into_owned(),
        mtime: mtime_of(meta),
        title,
        artist,
        album_artist,
        album,
        track_number: num(ItemKey::TrackNumber),
        disc_number: num(ItemKey::DiscNumber).max(1),
        year,
        genre,
        duration_ms: props.duration().as_millis() as u64,
        codec: codec.into(),
        bitrate: props.audio_bitrate().or(props.overall_bitrate()).unwrap_or(0),
        sample_rate: props.sample_rate().unwrap_or(44100),
        bit_depth: if bit_depth == 0 && matches!(codec, "FLAC" | "WAV" | "AIFF") { 16 } else { bit_depth },
        file_size: meta.len(),
    })
}

pub struct ScanOutcome {
    pub changed: bool,
}

/// Parcourt les dossiers, met à jour la base et extrait les pochettes manquantes.
pub fn scan(conn: &mut Connection, folders: &[String], cover_dir: &Path, progress: &(dyn Fn(ScanProgress) + Sync)) -> rusqlite::Result<ScanOutcome> {
    progress(ScanProgress { scanning: true, current: 0, total: 0, current_path: String::new() });

    // 1. Inventaire du disque.
    let mut on_disk: Vec<(PathBuf, std::fs::Metadata)> = Vec::new();
    for root in folders {
        for entry in WalkDir::new(root).follow_links(true).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() && is_audio(entry.path()) {
                if let Ok(meta) = entry.metadata() {
                    on_disk.push((entry.into_path(), meta));
                }
            }
        }
    }

    // 2. Comparaison avec la base (mtime).
    let known: HashMap<String, i64> = {
        let mut stmt = conn.prepare("SELECT path, mtime FROM tracks")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    let disk_paths: HashSet<String> = on_disk.iter().map(|(p, _)| p.to_string_lossy().into_owned()).collect();
    let removed: Vec<String> = known.keys().filter(|p| !disk_paths.contains(*p)).cloned().collect();
    let todo: Vec<&(PathBuf, std::fs::Metadata)> = on_disk
        .iter()
        .filter(|(p, m)| known.get(p.to_string_lossy().as_ref()) != Some(&mtime_of(m)))
        .collect();

    let total = todo.len();
    let done = AtomicUsize::new(0);
    let last_emit = Mutex::new(Instant::now());

    // 3. Lecture des tags en parallèle.
    let scanned: Vec<ScannedTrack> = todo
        .par_iter()
        .filter_map(|(p, m)| {
            let t = read_track(p, m);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if let Ok(mut last) = last_emit.try_lock() {
                if last.elapsed().as_millis() > 100 {
                    *last = Instant::now();
                    progress(ScanProgress { scanning: true, current: n, total, current_path: p.to_string_lossy().into_owned() });
                }
            }
            t
        })
        .collect();

    // 4. Écriture.
    let changed = !scanned.is_empty() || !removed.is_empty();
    let tx = conn.transaction()?;
    {
        let mut del = tx.prepare("DELETE FROM tracks WHERE path = ?1")?;
        for p in &removed {
            del.execute([p])?;
        }
        let mut ins = tx.prepare(
            "INSERT INTO tracks (id, path, mtime, title, artist, album_artist, album, album_id, track_number, disc_number,
                                 year, genre, duration_ms, codec, bitrate, sample_rate, bit_depth, file_size, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, title = excluded.title, artist = excluded.artist,
                album_artist = excluded.album_artist, album = excluded.album, album_id = excluded.album_id,
                track_number = excluded.track_number, disc_number = excluded.disc_number, year = excluded.year,
                genre = excluded.genre, duration_ms = excluded.duration_ms, codec = excluded.codec,
                bitrate = excluded.bitrate, sample_rate = excluded.sample_rate, bit_depth = excluded.bit_depth,
                file_size = excluded.file_size",
        )?;
        // Au premier scan, la date d'ajout = date du fichier, pour que « Ajoutés récemment » ait du sens.
        let first_scan = known.is_empty();
        for t in &scanned {
            let added = if first_scan { t.mtime } else { now_ms() };
            ins.execute(params![
                fnv1a(&t.path),
                t.path,
                t.mtime,
                t.title,
                t.artist,
                t.album_artist,
                t.album,
                album_id(&t.album_artist, &t.album),
                t.track_number,
                t.disc_number,
                t.year,
                t.genre,
                t.duration_ms as i64,
                t.codec,
                t.bitrate,
                t.sample_rate,
                t.bit_depth,
                t.file_size as i64,
                added
            ])?;
        }
        tx.execute("DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)", [])?;
    }
    tx.commit()?;

    // 5. Pochettes des albums nouveaux.
    let missing: Vec<(String, Vec<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT album_id, group_concat(path, char(10)) FROM tracks
             WHERE album_id NOT IN (SELECT id FROM albums) GROUP BY album_id",
        )?;
        let rows = stmt.query_map([], |r| {
            let paths: String = r.get(1)?;
            Ok((r.get::<_, String>(0)?, paths.split('\n').map(String::from).collect()))
        })?;
        rows.collect::<Result<_, _>>()?
    };
    if !missing.is_empty() {
        let _ = std::fs::create_dir_all(cover_dir);
        let covers: Vec<(String, bool, AlbumColors)> = missing
            .par_iter()
            .map(|(id, paths)| match find_cover(paths) {
                Some(img) => {
                    let colors = palette_from_image(&img);
                    let ok = save_cover(&img, &cover_dir.join(format!("{id}.jpg")));
                    (id.clone(), ok, colors)
                }
                None => (id.clone(), false, palette_from_seed(id)),
            })
            .collect();
        let tx = conn.transaction()?;
        {
            let mut ins = tx.prepare("INSERT OR REPLACE INTO albums VALUES (?1, ?2, ?3, ?4, ?5)")?;
            for (id, has, c) in &covers {
                ins.execute(params![id, has, c.dominant, c.accent, c.muted])?;
            }
        }
        tx.commit()?;
    }

    progress(ScanProgress { scanning: false, current: total, total, current_path: String::new() });
    Ok(ScanOutcome { changed: changed || !missing.is_empty() })
}

// ---------- pochettes ----------

fn find_cover(paths: &[String]) -> Option<DynamicImage> {
    // Image intégrée : on privilégie la face avant.
    for p in paths.iter().take(4) {
        if let Ok(tagged) = lofty::read_from_path(p) {
            let pics: Vec<_> = tagged.tags().iter().flat_map(|t| t.pictures().iter()).collect();
            let best = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pics.first());
            if let Some(pic) = best {
                if let Ok(img) = image::load_from_memory(pic.data()) {
                    return Some(img);
                }
            }
        }
    }
    // Image dans le dossier (cover.jpg, folder.png…), sauf dossiers « fourre-tout ».
    let dir = Path::new(paths.first()?).parent()?;
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.filter_map(Result::ok) {
        let p = e.path();
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        if COVER_NAMES.contains(&stem.as_str()) && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
            if let Ok(img) = image::open(&p) {
                return Some(img);
            }
        }
    }
    None
}

/// Écriture atomique (fichier temporaire puis renommage) : un lecteur externe
/// (Caelestia via MPRIS) ne doit jamais voir une image à moitié écrite.
fn save_cover(img: &DynamicImage, dest: &Path) -> bool {
    let small = if img.width() > COVER_SIZE || img.height() > COVER_SIZE { img.thumbnail(COVER_SIZE, COVER_SIZE) } else { img.clone() };
    let tmp = dest.with_extension("jpg.part");
    let Ok(file) = std::fs::File::create(&tmp) else { return false };
    let mut w = std::io::BufWriter::new(file);
    let ok = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 90).encode_image(&DynamicImage::ImageRgb8(small.to_rgb8())).is_ok();
    let ok = ok && std::io::Write::flush(&mut w).is_ok();
    drop(w);
    if ok && std::fs::rename(&tmp, dest).is_ok() {
        return true;
    }
    let _ = std::fs::remove_file(&tmp);
    false
}

// ---------- couleurs ----------

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

fn hsl(h: f64, s: f64, l: f64) -> String {
    format!("hsl({} {}% {}%)", h.round() as i64, (s * 100.0).round() as i64, (l * 100.0).round() as i64)
}

/// Palette dominante / accent / sourdine à partir de la pochette (histogramme de teintes).
pub fn palette_from_image(img: &DynamicImage) -> AlbumColors {
    let thumb = img.thumbnail(32, 32);
    const BUCKETS: usize = 18;
    let mut weight = [0f64; BUCKETS];
    let mut hue_sum = [0f64; BUCKETS];
    let mut sat_sum = [0f64; BUCKETS];
    let mut light_sum = [0f64; BUCKETS];
    let (mut all_l, mut n) = (0f64, 0f64);

    for (_, _, px) in thumb.pixels() {
        let (h, s, l) = rgb_to_hsl(px[0], px[1], px[2]);
        all_l += l;
        n += 1.0;
        if s < 0.18 || !(0.12..=0.88).contains(&l) {
            continue;
        }
        let b = ((h / 360.0) * BUCKETS as f64) as usize % BUCKETS;
        let w = s * (1.0 - (l - 0.5).abs());
        weight[b] += w;
        hue_sum[b] += h * w;
        sat_sum[b] += s * w;
        light_sum[b] += l * w;
    }

    let mut order: Vec<usize> = (0..BUCKETS).filter(|&b| weight[b] > 0.0).collect();
    order.sort_by(|a, b| weight[*b].total_cmp(&weight[*a]));

    let avg = |b: usize| (hue_sum[b] / weight[b], sat_sum[b] / weight[b], light_sum[b] / weight[b]);
    match order.first() {
        None => {
            // Pochette quasi monochrome : palette neutre.
            let l = if n > 0.0 { all_l / n } else { 0.4 };
            AlbumColors {
                dominant: hsl(230.0, 0.08, l.clamp(0.3, 0.5)),
                accent: hsl(230.0, 0.12, (l + 0.2).clamp(0.55, 0.7)),
                muted: hsl(230.0, 0.1, 0.16),
            }
        }
        Some(&d) => {
            let (dh, ds, dl) = avg(d);
            let accent_bucket = order.iter().skip(1).find(|&&b| {
                let dist = (b as i64 - d as i64).rem_euclid(BUCKETS as i64);
                dist.min(BUCKETS as i64 - dist) >= 2 && weight[b] > weight[d] * 0.15
            });
            let (ah, a_s, _) = accent_bucket.map(|&b| avg(b)).unwrap_or(((dh + 35.0) % 360.0, ds, dl));
            AlbumColors {
                dominant: hsl(dh, ds.clamp(0.4, 0.85), dl.clamp(0.35, 0.55)),
                accent: hsl(ah, a_s.clamp(0.55, 0.95), 0.62),
                muted: hsl(dh, (ds * 0.5).clamp(0.2, 0.45), 0.18),
            }
        }
    }
}

pub fn palette_from_seed(seed: &str) -> AlbumColors {
    let h = u64::from_str_radix(&fnv1a(seed)[..8], 16).unwrap_or(0);
    let base = (h % 360) as f64;
    let acc = (base + 40.0 + ((h >> 12) % 80) as f64) % 360.0;
    AlbumColors { dominant: hsl(base, 0.6, 0.48), accent: hsl(acc, 0.78, 0.62), muted: hsl(base, 0.35, 0.2) }
}
