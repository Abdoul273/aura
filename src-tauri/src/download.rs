// Téléchargement de musique : recherche YouTube (yt-dlp), extraction audio sans réencodage, tags propres,
// pochette carrée et paroles écrites dans le fichier (et en .lrc à côté) pour qu'elles s'affichent dès
// la première lecture. Même robustesse que YT-DOWNLOAD : cookies, reprises, attente croissante sur
// « 429 », fragments parallèles, relance si le débit s'effondre.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::Tag;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;
use crate::lyrics::{self, Found};

/// Téléchargements simultanés (au-delà, YouTube répond vite « 429 »).
const MAX_PARALLEL: usize = 2;
const MAX_ATTEMPTS: u32 = 4;
const SUBFOLDER: &str = "Téléchargements Aura";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlResult {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration_s: f64,
    pub views: u64,
    pub thumbnail: String,
    pub verified: bool,
    /// Artiste et titre déduits (modifiables avant le téléchargement).
    pub artist: String,
    pub track: String,
    /// « audio » (version studio), « clip », « live » ou « other ».
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlJob {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail: String,
    /// queued | downloading | retrying | converting | tagging | lyrics | done | error | canceled
    pub status: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub error: Option<String>,
    /// synced | approx | plain | instrumental | none
    pub lyrics: Option<String>,
    pub path: Option<String>,
}

pub struct Downloader {
    jobs: Mutex<Vec<DlJob>>,
    pids: Mutex<HashMap<String, u32>>,
    canceled: Mutex<HashSet<String>>,
    slots: (Mutex<usize>, Condvar),
    probes: Mutex<HashMap<String, Option<Found>>>,
    work_dir: PathBuf,
    config_dir: PathBuf,
}

fn ytdlp() -> PathBuf {
    // Lancée depuis le menu, l'appli n'a pas toujours ~/.local/bin dans son PATH.
    if let Some(home) = dirs::home_dir() {
        let local = home.join(".local/bin/yt-dlp");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("yt-dlp")
}

fn lyrics_kind(f: &Option<Found>) -> &'static str {
    match f {
        Some(f) if f.instrumental => "instrumental",
        Some(f) if f.synced && !f.approximate => "synced",
        Some(f) if f.synced => "approx",
        Some(f) if !f.text.is_empty() => "plain",
        _ => "none",
    }
}

impl Downloader {
    pub fn new(work_dir: PathBuf, config_dir: PathBuf) -> Self {
        Downloader {
            jobs: Mutex::new(Vec::new()),
            pids: Mutex::new(HashMap::new()),
            canceled: Mutex::new(HashSet::new()),
            slots: (Mutex::new(0), Condvar::new()),
            probes: Mutex::new(HashMap::new()),
            work_dir,
            config_dir,
        }
    }

    fn base_cmd(&self) -> Command {
        let mut cmd = Command::new(ytdlp());
        // Cookies facultatifs (vidéos à limite d'âge, « confirmez que vous n'êtes pas un robot »).
        let cookies = self.config_dir.join("cookies.txt");
        if std::fs::metadata(&cookies).is_ok_and(|m| m.len() > 100) {
            cmd.arg("--cookies").arg(cookies);
        }
        cmd.args(["--no-warnings", "--color", "never", "--socket-timeout", "30", "--extractor-retries", "5"]);
        cmd
    }

    // ---------- recherche ----------

    pub fn search(&self, query: &str) -> Result<Vec<DlResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let target = if query.starts_with("http://") || query.starts_with("https://") { query.to_string() } else { format!("ytsearch20:{query}") };
        let out = self
            .base_cmd()
            .args(["--flat-playlist", "--dump-json", "--playlist-end", "60"])
            .arg(&target)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("yt-dlp introuvable ({e}). Installez-le : pipx install yt-dlp"))?;
        let mut results = Vec::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
            if let Some(r) = to_result(&v) {
                results.push(r);
            }
        }
        if results.is_empty() && !out.status.success() {
            return Err(error_message(&String::from_utf8_lossy(&out.stderr)));
        }
        Ok(results)
    }

    /// Paroles disponibles pour ce résultat (mémorisées pour le téléchargement).
    pub fn probe(&self, id: &str, artist: &str, track: &str, duration_s: f64) -> String {
        let key = probe_key(id, artist, track);
        if let Some(f) = self.probes.lock().unwrap().get(&key) {
            return lyrics_kind(f).into();
        }
        let found = lyrics::find_for(track, artist, "", (duration_s * 1000.0) as u64);
        let kind = lyrics_kind(&found).to_string();
        self.probes.lock().unwrap().insert(key, found);
        kind
    }

    // ---------- téléchargements ----------

    pub fn list(&self) -> Vec<DlJob> {
        self.jobs.lock().unwrap().clone()
    }

    pub fn clear_finished(&self) {
        self.jobs.lock().unwrap().retain(|j| !matches!(j.status.as_str(), "done" | "error" | "canceled"));
    }

    pub fn cancel(&self, app: &AppHandle, id: &str) {
        self.canceled.lock().unwrap().insert(id.to_string());
        if let Some(pid) = self.pids.lock().unwrap().get(id) {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
        self.update(app, id, |j| {
            if !matches!(j.status.as_str(), "done" | "error") {
                j.status = "canceled".into();
            }
        });
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, r: DlResult) -> DlJob {
        let job = DlJob {
            id: r.id.clone(),
            title: r.track.clone(),
            artist: r.artist.clone(),
            thumbnail: r.thumbnail.clone(),
            status: "queued".into(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            error: None,
            lyrics: None,
            path: None,
        };
        {
            let mut jobs = self.jobs.lock().unwrap();
            if let Some(existing) = jobs.iter().find(|j| j.id == r.id && !matches!(j.status.as_str(), "error" | "canceled")) {
                return existing.clone();
            }
            jobs.retain(|j| j.id != r.id);
            jobs.insert(0, job.clone());
        }
        self.canceled.lock().unwrap().remove(&r.id);
        let _ = app.emit("download:update", &job);

        let me = self.clone();
        std::thread::spawn(move || {
            // File d'attente : MAX_PARALLEL à la fois.
            {
                let (lock, cv) = &me.slots;
                let mut busy = lock.lock().unwrap();
                while *busy >= MAX_PARALLEL {
                    busy = cv.wait(busy).unwrap();
                }
                *busy += 1;
            }
            let id = r.id.clone();
            let result = if me.is_canceled(&id) { Err("canceled".to_string()) } else { me.run(&app, &r) };
            {
                let (lock, cv) = &me.slots;
                *lock.lock().unwrap() -= 1;
                cv.notify_one();
            }
            let _ = std::fs::remove_dir_all(me.work_dir.join(&id));
            match result {
                Ok(()) => {}
                Err(_) if me.is_canceled(&id) => me.update(&app, &id, |j| j.status = "canceled".into()),
                Err(e) => me.update(&app, &id, |j| {
                    j.status = "error".into();
                    j.error = Some(e.clone());
                }),
            }
        });
        job
    }

    fn is_canceled(&self, id: &str) -> bool {
        self.canceled.lock().unwrap().contains(id)
    }

    fn update(&self, app: &AppHandle, id: &str, f: impl FnOnce(&mut DlJob)) {
        let snapshot = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(j) = jobs.iter_mut().find(|j| j.id == id) else { return };
            f(j);
            j.clone()
        };
        let _ = app.emit("download:update", &snapshot);
    }

    fn run(&self, app: &AppHandle, r: &DlResult) -> Result<(), String> {
        let tmp = self.work_dir.join(&r.id);
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

        // 1. Téléchargement (avec reprises automatiques).
        let meta = self.fetch_audio(app, r, &tmp)?;
        let audio = find_audio(&tmp).ok_or("fichier audio introuvable après le téléchargement")?;

        // 2. Tags : les métadonnées musicales de YouTube priment sur ce qu'on déduit du titre.
        self.update(app, &r.id, |j| {
            j.status = "tagging".into();
            j.progress = 100.0;
        });
        let artist = meta.get("artist").filter(|a| !a.is_empty()).map(|a| primary_artists(a)).unwrap_or_else(|| r.artist.clone());
        let title = meta.get("track").filter(|t| !t.is_empty()).cloned().unwrap_or_else(|| r.track.clone());
        let album = meta.get("album").filter(|a| !a.is_empty()).cloned();
        let year = meta.get("year").filter(|y| y.len() == 4).cloned();
        let duration_ms = lofty::read_from_path(&audio).map(|f| f.properties().duration().as_millis() as u64).unwrap_or((r.duration_s * 1000.0) as u64);

        // 3. Paroles (déjà cherchées pendant la recherche si possible).
        self.update(app, &r.id, |j| {
            j.status = "lyrics".into();
            j.artist = artist.clone();
            j.title = title.clone();
        });
        let cached = self.probes.lock().unwrap().get(&probe_key(&r.id, &r.artist, &r.track)).cloned();
        // L'aperçu portait sur l'artiste/titre déduits ; si YouTube en donne de meilleurs, on recherche à nouveau.
        let found = match cached {
            Some(f) if lyrics_kind(&f) == "synced" || (artist == r.artist && title == r.track) => f,
            _ => lyrics::find_for(&title, &artist, album.as_deref().unwrap_or(""), duration_ms),
        };
        let kind = lyrics_kind(&found);

        let cover = find_image(&tmp).and_then(|p| square_cover(&p));
        write_tags(&audio, &title, &artist, album.as_deref().unwrap_or(&title), year.as_deref(), cover, found.as_ref())?;

        // 4. Rangement dans la bibliothèque.
        let dest_dir = music_dir(app).join(SUBFOLDER);
        std::fs::create_dir_all(&dest_dir).map_err(|e| format!("dossier {} : {e}", dest_dir.display()))?;
        let ext = audio.extension().and_then(|e| e.to_str()).unwrap_or("m4a");
        let base = sanitize(&if artist.is_empty() { title.clone() } else { format!("{artist} - {title}") });
        let dest = unique_path(&dest_dir, &base, ext);
        move_file(&audio, &dest)?;
        // .lrc voisin : lu en priorité par Aura et par la plupart des lecteurs.
        if let Some(f) = found.as_ref().filter(|f| f.synced && !f.approximate) {
            let header = format!("[ar:{artist}]\n[ti:{title}]\n[length:{:02}:{:02}]\n[re:Aura — {}]\n", duration_ms / 60_000, duration_ms / 1000 % 60, f.source);
            let _ = std::fs::write(dest.with_extension("lrc"), header + &f.text);
        }

        self.update(app, &r.id, |j| {
            j.status = "done".into();
            j.lyrics = Some(kind.into());
            j.path = Some(dest.to_string_lossy().into_owned());
            j.speed.clear();
            j.eta.clear();
        });

        // 5. Scan incrémental pour faire apparaître le titre (après un éventuel scan en cours).
        let app = app.clone();
        std::thread::spawn(move || {
            let st = app.state::<Arc<AppState>>().inner().clone();
            while st.scanning.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(300));
            }
            let _ = crate::commands::run_scan(&app, &st);
        });
        Ok(())
    }

    fn fetch_audio(&self, app: &AppHandle, r: &DlResult, tmp: &Path) -> Result<HashMap<String, String>, String> {
        let mut wait = 5u64;
        let mut attempt = 0;
        loop {
            attempt += 1;
            self.update(app, &r.id, |j| {
                j.status = "downloading".into();
                j.error = None;
            });
            let (ok, meta, stderr) = self.run_ytdlp(app, r, tmp)?;
            if self.is_canceled(&r.id) {
                return Err("canceled".into());
            }
            if ok {
                return Ok(meta);
            }
            let lower = stderr.to_lowercase();
            let rate_limited = lower.contains("429") || lower.contains("too many requests");
            let recoverable = rate_limited
                || ["timed out", "timeout", "connection", "temporary failure", "http error 5", "incompleteread", "unable to download", "network"].iter().any(|k| lower.contains(k));
            if !recoverable || attempt >= MAX_ATTEMPTS {
                return Err(error_message(&stderr));
            }
            let pause = if rate_limited { wait.max(20) } else { wait };
            self.update(app, &r.id, |j| {
                j.status = "retrying".into();
                j.error = Some(format!("{} — nouvelle tentative dans {pause} s ({} restante(s))", error_message(&stderr), MAX_ATTEMPTS - attempt));
            });
            for _ in 0..pause * 5 {
                if self.is_canceled(&r.id) {
                    return Err("canceled".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            wait = (wait * 2).min(60);
        }
    }

    /// Un passage de yt-dlp : (succès, métadonnées, stderr).
    fn run_ytdlp(&self, app: &AppHandle, r: &DlResult, tmp: &Path) -> Result<(bool, HashMap<String, String>, String), String> {
        let mut cmd = self.base_cmd();
        cmd.args([
            "-f", "bestaudio[ext=m4a]/bestaudio/best",
            "-x", "--audio-format", "m4a", "--audio-quality", "0",
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "--no-playlist", "--no-simulate", "--continue",
            "--progress", "--newline",
            "--progress-template", "download:AURA_PROG:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
            "--print", "before_dl:AURA_META:%(artist|)s\t%(track|)s\t%(album|)s\t%(release_year|)s",
            "--retries", "10", "--fragment-retries", "10", "--retry-sleep", "http:exp=2:60",
            "--file-access-retries", "5",
            "--concurrent-fragments", "4", "--http-chunk-size", "2M", "--throttled-rate", "100K",
            "-o",
        ]);
        cmd.arg(tmp.join("%(id)s.%(ext)s")).arg(&r.url);
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("yt-dlp introuvable ({e}). Installez-le : pipx install yt-dlp"))?;
        self.pids.lock().unwrap().insert(r.id.clone(), child.id());

        let meta = Mutex::new(HashMap::new());
        let stderr_text = Mutex::new(String::new());
        let last_emit = Mutex::new(Instant::now() - Duration::from_secs(1));
        let handle_line = |line: &str| {
            if let Some(p) = line.split("AURA_PROG:").nth(1) {
                let mut it = p.split('|').map(str::trim);
                let pct: f64 = it.next().unwrap_or("").trim_end_matches('%').trim().parse().unwrap_or(0.0);
                let speed = it.next().unwrap_or("").to_string();
                let eta = it.next().unwrap_or("").to_string();
                let mut last = last_emit.lock().unwrap();
                if last.elapsed() >= Duration::from_millis(250) || pct >= 100.0 {
                    *last = Instant::now();
                    self.update(app, &r.id, |j| {
                        j.progress = pct.clamp(0.0, 100.0);
                        j.speed = if speed.contains("Unknown") || speed == "NA" { String::new() } else { speed };
                        j.eta = if eta.contains("Unknown") || eta == "NA" { String::new() } else { eta };
                        if pct >= 100.0 {
                            j.status = "converting".into();
                        }
                    });
                }
            } else if let Some(m) = line.split("AURA_META:").nth(1) {
                let f: Vec<&str> = m.split('\t').collect();
                let mut meta = meta.lock().unwrap();
                for (i, key) in ["artist", "track", "album", "year"].iter().enumerate() {
                    if let Some(v) = f.get(i).map(|v| v.trim()).filter(|v| !v.is_empty() && *v != "NA") {
                        meta.insert(key.to_string(), v.to_string());
                    }
                }
            } else if !line.trim().is_empty() && !line.starts_with("[download]") {
                let mut s = stderr_text.lock().unwrap();
                s.push_str(line);
                s.push('\n');
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        std::thread::scope(|s| {
            if let Some(err) = stderr {
                let handle_line = &handle_line;
                s.spawn(move || read_lines(err, handle_line));
            }
            if let Some(out) = stdout {
                read_lines(out, &handle_line);
            }
        });
        let status = child.wait().map_err(|e| e.to_string())?;
        self.pids.lock().unwrap().remove(&r.id);
        Ok((status.success(), meta.into_inner().unwrap(), stderr_text.into_inner().unwrap()))
    }
}

fn probe_key(id: &str, artist: &str, track: &str) -> String {
    format!("{id}|{artist}|{track}")
}

fn read_lines(r: impl Read, f: &dyn Fn(&str)) {
    // Découpe aussi sur « \r » (barres de progression).
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    while reader.read_until(b'\n', &mut buf).map(|n| n > 0).unwrap_or(false) {
        for part in String::from_utf8_lossy(&buf).split('\r') {
            f(part.trim_end());
        }
        buf.clear();
    }
}

fn to_result(v: &Value) -> Option<DlResult> {
    let id = v["id"].as_str()?.to_string();
    // Chaînes et playlists dans les résultats : on ne garde que les vidéos.
    if v["ie_key"].as_str().is_some_and(|k| k != "Youtube") && v["_type"].as_str() == Some("url") {
        return None;
    }
    let title = v["title"].as_str()?.to_string();
    let channel = v["channel"].as_str().or(v["uploader"].as_str()).unwrap_or("").to_string();
    let lower = format!("{} {}", title.to_lowercase(), channel.to_lowercase());
    let kind = if channel.ends_with(" - Topic") || ["(audio)", "official audio", "audio officiel", "[audio]", "lyrics", "paroles", "lyric video"].iter().any(|k| lower.contains(k)) {
        "audio"
    } else if lower.contains(" live") || lower.contains("(live") || lower.contains("[live") || lower.contains("en direct") {
        "live"
    } else if ["clip", "video", "vidéo", "visualizer"].iter().any(|k| lower.contains(k)) {
        "clip"
    } else {
        "other"
    };
    let (artist, track) = lyrics::guess_artist_title(&title, channel.trim_end_matches(" - Topic"));
    let url = v["webpage_url"].as_str().or(v["url"].as_str()).filter(|u| u.starts_with("http")).map(String::from).unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
    Some(DlResult {
        thumbnail: format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
        url,
        duration_s: v["duration"].as_f64().unwrap_or(0.0),
        views: v["view_count"].as_u64().unwrap_or(0),
        verified: v["channel_is_verified"].as_bool() == Some(true),
        id,
        title,
        channel,
        artist,
        track,
        kind: kind.into(),
    })
}

/// « Booba, Kalash » reste tel quel ; YouTube répète parfois l'artiste principal.
fn primary_artists(a: &str) -> String {
    let mut seen = Vec::new();
    for part in a.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        if !seen.iter().any(|s: &String| s.eq_ignore_ascii_case(part)) {
            seen.push(part.to_string());
        }
    }
    seen.join(", ")
}

/// Dernière erreur utile de yt-dlp, en clair.
fn error_message(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("429") || lower.contains("too many requests") {
        return "YouTube limite les requêtes (429)".into();
    }
    if lower.contains("sign in to confirm") || lower.contains("not a bot") {
        return "YouTube demande une connexion : placez un cookies.txt dans le dossier de configuration d'Aura".into();
    }
    if lower.contains("video unavailable") || lower.contains("private video") {
        return "Vidéo indisponible".into();
    }
    if lower.contains("ffmpeg") && lower.contains("not found") {
        return "ffmpeg est requis pour extraire l'audio".into();
    }
    stderr
        .lines()
        .rev()
        .find(|l| l.contains("ERROR"))
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .map(|l| l.replace("ERROR: ", "").chars().take(220).collect())
        .unwrap_or_else(|| "échec du téléchargement".into())
}

fn find_audio(dir: &Path) -> Option<PathBuf> {
    let exts = ["m4a", "mp3", "opus", "ogg", "webm", "flac", "aac", "wav"];
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.contains(&e.to_lowercase().as_str()))
    })
}

fn find_image(dir: &Path) -> Option<PathBuf> {
    let exts = ["jpg", "jpeg", "png", "webp"];
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.contains(&e.to_lowercase().as_str()))
    })
}

/// Vignette 16:9 → pochette carrée (centre), JPEG ≤ 1200 px.
fn square_cover(path: &Path) -> Option<Vec<u8>> {
    let img = image::open(path).ok()?;
    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    let mut img = img.crop_imm((w - side) / 2, (h - side) / 2, side, side);
    if side > 1200 {
        img = img.resize(1200, 1200, image::imageops::FilterType::Lanczos3);
    }
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img.to_rgb8()).write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
    Some(buf.into_inner())
}

fn write_tags(path: &Path, title: &str, artist: &str, album: &str, year: Option<&str>, cover: Option<Vec<u8>>, found: Option<&Found>) -> Result<(), String> {
    let mut tagged = lofty::read_from_path(path).map_err(|e| format!("lecture des tags : {e}"))?;
    if tagged.primary_tag().is_none() {
        let tt = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tt));
    }
    let tag = tagged.primary_tag_mut().ok_or("tags non pris en charge")?;
    tag.set_title(title.to_string());
    if !artist.is_empty() {
        tag.set_artist(artist.to_string());
    }
    tag.set_album(album.to_string());
    if let Some(y) = year {
        tag.insert_text(ItemKey::Year, y.to_string());
    }
    if let Some(bytes) = cover {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(Picture::unchecked(bytes).pic_type(PictureType::CoverFront).mime_type(MimeType::Jpeg).build());
    }
    if let Some(f) = found.filter(|f| !f.instrumental && !f.text.trim().is_empty()) {
        // Synchro exacte : LRC complet. Sinon texte brut (la version synchronisée approximative
        // reste proposée par la recherche en ligne, avec son avertissement).
        let text = if f.synced && !f.approximate {
            f.text.clone()
        } else {
            match lyrics::from_text(&f.text, &f.source) {
                Some(crate::models::Lyrics::Synced { lines, .. }) => lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n"),
                Some(crate::models::Lyrics::Plain { text, .. }) => text,
                _ => String::new(),
            }
        };
        if !text.is_empty() {
            tag.insert_text(ItemKey::Lyrics, text);
        }
    }
    tagged.save_to_path(path, WriteOptions::default()).map_err(|e| format!("écriture des tags : {e}"))
}

fn music_dir(app: &AppHandle) -> PathBuf {
    let st = app.state::<Arc<AppState>>();
    st.settings
        .get()
        .music_folders
        .first()
        .map(PathBuf::from)
        .or_else(dirs::audio_dir)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Musique"))
}

fn sanitize(s: &str) -> String {
    let cleaned: String = s.chars().map(|c| if "/\\:*?\"<>|\0".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_matches('.').trim();
    if cleaned.is_empty() { "Titre".into() } else { cleaned.chars().take(150).collect() }
}

fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    p
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // Autre système de fichiers : copie puis suppression.
    std::fs::copy(from, to).map_err(|e| format!("copie vers {} : {e}", to.display()))?;
    let _ = std::fs::remove_file(from);
    Ok(())
}
