// Paroles : .lrc voisin → tag intégré → recherche en ligne (LRCLIB, NetEase, Genius), mise en cache.
//
// Beaucoup de fichiers n'ont pas de tags (rips YouTube : « 2Pac_-_When_It_Rains(256k) ») : on reconstruit
// plusieurs hypothèses artiste/titre (tags, titre, nom de fichier), on interroge toutes les sources en
// parallèle, puis on note chaque résultat (titre, artiste, durée) pour ne jamais afficher les paroles
// d'un autre morceau. Des paroles synchronisées d'une version de durée différente (clip avec intro)
// restent affichées synchronisées mais marquées « approximatives » : le décalage se règle dans l'interface.
// En dernier recours, la recherche manuelle (`search` / `choose`) laisse l'utilisateur choisir.

use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use lofty::prelude::*;
use serde_json::{json, Value};

use crate::db::Db;
use crate::models::{Lyrics, LyricsLine, LyricsResult, LyricsSearch, LyricsWord};

/// Écart de durée sous lequel des paroles synchronisées tombent juste (max avec 2 % de la durée).
const EXACT_SYNC_S: f64 = 3.0;
/// Au-delà, les paroles synchronisées d'une autre version seraient trop décalées : texte brut.
const APPROX_SYNC_S: f64 = 45.0;
/// Délai avant de retenter une recherche restée sans résultat.
const RETRY_AFTER: Duration = Duration::from_secs(24 * 3600);
const CACHE_VERSION: &str = "v4";
const BROWSER_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/// Recherche hors ligne dans les paroles en cache et les fichiers voisins.
pub fn search_library(db: &Db, cache_dir: &Path, query: &str) -> Vec<String> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 3 { return vec![]; }
    let mut found = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(id) = name.strip_prefix(&format!("{CACHE_VERSION}-")).and_then(|s| s.strip_suffix(".json")) else { continue };
            if std::fs::read_to_string(entry.path()).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .and_then(|value| value["text"].as_str().map(|s| s.to_lowercase().contains(&needle))) == Some(true) {
                found.insert(id.to_string());
            }
        }
    }
    let Ok(tracks) = db.snapshot_tracks() else { return found.into_iter().take(50).collect() };
    for track in tracks {
        if found.len() >= 50 { break; }
        if found.contains(&track.id) { continue; }
        let path = Path::new(&track.file_path);
        for ext in ["lrc", "LRC", "txt", "TXT"] {
            if std::fs::read_to_string(path.with_extension(ext)).is_ok_and(|text| text.to_lowercase().contains(&needle)) {
                found.insert(track.id.clone());
                break;
            }
        }
    }
    found.into_iter().collect()
}

pub fn get(db: &Db, cache_dir: &Path, track_id: &str, force: bool) -> Option<Lyrics> {
    let brief = db.track_brief(track_id)?;
    let path = Path::new(&brief.path);

    // 1. Fichier .lrc / .txt voisin, puis tag intégré (USLT, LYRICS…).
    let mut plain_fallback: Option<Lyrics> = None;
    for text in local_texts(path) {
        match from_text(&text, "Fichier local") {
            Some(l @ Lyrics::Synced { .. }) => return Some(l),
            Some(l) if plain_fallback.is_none() => plain_fallback = Some(l),
            _ => {}
        }
    }

    // 2. Cache des recherches en ligne (y compris un choix manuel).
    let _ = std::fs::create_dir_all(cache_dir);
    let (cached, none_marker) = cache_paths(cache_dir, track_id);
    if force {
        let _ = std::fs::remove_file(&cached);
        let _ = std::fs::remove_file(&none_marker);
    }
    if let Some(l) = read_cache(&cached) {
        return Some(prefer(l, plain_fallback));
    }
    if !force && is_fresh(&none_marker) {
        return plain_fallback;
    }

    // 3. Recherche en ligne.
    let queries = Query::variants(&brief.title, &brief.artist, &brief.album, &brief.path, brief.duration_ms);
    if queries.is_empty() {
        return plain_fallback;
    }
    if queries.iter().any(|q| q.version.iter().any(|v| *v == "instrumental" || *v == "karaoke")) {
        return Some(Lyrics::Instrumental { source: "Nom du fichier".into() });
    }
    match fetch_online(&queries) {
        Ok(Some(found)) => {
            let _ = std::fs::write(&cached, found.to_string());
            read_cache(&cached).map(|l| prefer(l, plain_fallback.clone())).or(plain_fallback)
        }
        Ok(None) => {
            let _ = std::fs::write(&none_marker, "");
            plain_fallback
        }
        Err(_) => plain_fallback, // réseau indisponible : on réessaiera au prochain affichage
    }
}

/// Recherche manuelle : tous les résultats plausibles, avec leurs paroles, pour que l'utilisateur choisisse.
pub fn search(db: &Db, track_id: &str, query: Option<String>) -> Option<LyricsSearch> {
    let brief = db.track_brief(track_id)?;
    let duration_s = brief.duration_ms as f64 / 1000.0;
    let variants = Query::variants(&brief.title, &brief.artist, &brief.album, &brief.path, brief.duration_ms);
    let text = query
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty())
        .or_else(|| variants.first().map(Query::text))
        .unwrap_or_default();
    if text.is_empty() {
        return Some(LyricsSearch { query: text, results: Vec::new() });
    }

    let agent = agent();
    let hits: Mutex<Vec<Hit>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        s.spawn(|| {
            if let Ok(found) = lrclib_search(&agent, &[("q", text.clone())]) {
                hits.lock().unwrap().extend(found);
            }
        });
        s.spawn(|| {
            let found = netease_search(&agent, &text).unwrap_or_default();
            let with_lyrics = fetch_netease_lyrics(&agent, found.into_iter().take(6).collect());
            hits.lock().unwrap().extend(with_lyrics);
        });
        s.spawn(|| {
            let found = genius_search(&agent, &text).unwrap_or_default();
            let with_lyrics = fetch_genius_lyrics(&agent, found.into_iter().take(3).collect());
            hits.lock().unwrap().extend(with_lyrics);
        });
    });

    let wanted = tokens(&text);
    let mut results: Vec<(f64, LyricsResult)> = hits
        .into_inner()
        .unwrap()
        .into_iter()
        .filter_map(|h| {
            let text = h.synced.clone().or(h.plain.clone())?;
            let synced = h.synced.is_some();
            let hay = tokens(&format!("{} {}", h.artist, h.title));
            let relevance = if wanted.is_empty() { 0.0 } else { wanted.iter().filter(|w| hay.iter().any(|x| same_word(w, x))).count() as f64 / wanted.len() as f64 };
            let diff = if h.duration_s > 0.0 && duration_s > 0.0 { (h.duration_s - duration_s).abs() } else { 60.0 };
            let rank = (relevance * 10.0).round() * 100.0 + if synced { 50.0 } else { 0.0 } - diff.min(49.0);
            Some((rank, LyricsResult { title: h.title, artist: h.artist, album: h.album, duration_s: h.duration_s, source: h.source.into(), synced, text }))
        })
        .collect();
    results.sort_by(|a, b| b.0.total_cmp(&a.0));
    // Même source, même titre, même durée : doublon.
    let mut seen = std::collections::HashSet::new();
    let results = results
        .into_iter()
        .map(|(_, r)| r)
        .filter(|r| seen.insert((r.source.clone(), compact(&r.title), compact(&r.artist), r.duration_s.round() as i64, r.synced)))
        .take(30)
        .collect();
    Some(LyricsSearch { query: text, results })
}

/// Enregistre le résultat choisi à la main : il devient les paroles du morceau.
pub fn choose(db: &Db, cache_dir: &Path, track_id: &str, text: &str, source: &str, duration_s: f64) -> Option<Lyrics> {
    let brief = db.track_brief(track_id)?;
    let _ = std::fs::create_dir_all(cache_dir);
    let (cached, none_marker) = cache_paths(cache_dir, track_id);
    let track_s = brief.duration_ms as f64 / 1000.0;
    let synced = matches!(from_text(text, source), Some(Lyrics::Synced { .. }));
    let approximate = synced && !exact_duration(track_s, duration_s);
    let value = json!({ "text": text, "source": source, "synced": synced, "approximate": approximate, "manual": true });
    std::fs::write(&cached, value.to_string()).ok()?;
    let _ = std::fs::remove_file(&none_marker);
    read_cache(&cached)
}

/// Paroles trouvées en ligne pour un morceau qui n'est pas (encore) dans la bibliothèque.
#[derive(Clone, Debug)]
pub struct Found {
    pub text: String,
    pub source: String,
    pub synced: bool,
    /// Synchronisées sur une version de durée différente.
    pub approximate: bool,
    pub instrumental: bool,
}

pub fn find_for(title: &str, artist: &str, album: &str, duration_ms: u64) -> Option<Found> {
    let queries = Query::variants(title, artist, album, "", duration_ms);
    if queries.is_empty() {
        return None;
    }
    let v = fetch_online(&queries).ok()??;
    Some(Found {
        text: v["text"].as_str().unwrap_or("").to_string(),
        source: v["source"].as_str().unwrap_or("En ligne").to_string(),
        synced: v["synced"].as_bool() == Some(true),
        approximate: v["approximate"].as_bool() == Some(true),
        instrumental: v["instrumental"].as_bool() == Some(true),
    })
}

/// Artiste et titre propres depuis un titre de vidéo (« Booba - Arc-en-ciel (Audio) ») et sa chaîne.
pub fn guess_artist_title(video_title: &str, channel: &str) -> (String, String) {
    let decoded = url_decode(video_title);
    let parts = split_dash(&decoded);
    if parts.len() >= 2 {
        let artists = split_artists(parts[0]);
        let title = clean(parts[1]);
        let feats: Vec<String> = featured(parts[1]).into_iter().filter(|f| !artists.contains(f)).collect();
        let title = if feats.is_empty() { title } else { format!("{title} (feat. {})", feats.join(", ")) };
        if !artists.is_empty() && !title.is_empty() {
            return (artists.join(", "), title);
        }
    }
    let mut artist = usable_artist(channel).unwrap_or_default();
    for suffix in ["Officiel", "Official", "Music", "Musique", "TV"] {
        if let Some(s) = artist.strip_suffix(suffix) {
            if !s.trim().is_empty() {
                artist = s.trim().to_string();
            }
        }
    }
    let title = clean(&decoded);
    (artist, if title.is_empty() { decoded.trim().to_string() } else { title })
}

fn cache_paths(cache_dir: &Path, track_id: &str) -> (PathBuf, PathBuf) {
    (cache_dir.join(format!("{CACHE_VERSION}-{track_id}.json")), cache_dir.join(format!("{CACHE_VERSION}-{track_id}.none")))
}

fn local_texts(path: &Path) -> Vec<String> {
    let mut local = Vec::new();
    for ext in ["lrc", "LRC", "txt", "TXT"] {
        if let Ok(text) = std::fs::read_to_string(path.with_extension(ext)) {
            local.push(text);
        }
    }
    if let Ok(tagged) = lofty::read_from_path(path) {
        for tag in tagged.tags() {
            if let Some(text) = tag.get_string(ItemKey::Lyrics) {
                local.push(text.to_string());
            }
        }
    }
    local
}

/// Des paroles locales en texte brut valent mieux qu'un texte brut trouvé en ligne.
fn prefer(online: Lyrics, local_plain: Option<Lyrics>) -> Lyrics {
    match (&online, local_plain) {
        (Lyrics::Plain { .. }, Some(local)) => local,
        _ => online,
    }
}

fn is_fresh(p: &PathBuf) -> bool {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < RETRY_AFTER)
}

fn read_cache(p: &PathBuf) -> Option<Lyrics> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    let source = v["source"].as_str().unwrap_or("En ligne");
    if v["instrumental"].as_bool() == Some(true) {
        return Some(Lyrics::Instrumental { source: source.into() });
    }
    let text = v["text"].as_str()?;
    match from_text(text, source)? {
        // Paroles synchronisées d'une version trop différente : texte seul.
        Lyrics::Synced { lines, source, .. } if v["synced"].as_bool() == Some(false) => {
            let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
            Some(Lyrics::Plain { text: text.trim().to_string(), source })
        }
        Lyrics::Synced { lines, source, .. } => Some(Lyrics::Synced { lines, source, approximate: v["approximate"].as_bool() == Some(true) }),
        other => Some(other),
    }
}

fn exact_duration(track_s: f64, cand_s: f64) -> bool {
    track_s <= 0.0 || cand_s <= 0.0 || (track_s - cand_s).abs() <= EXACT_SYNC_S.max(track_s * 0.02)
}

// ---------- requête ----------

#[derive(Clone, Debug)]
struct Query {
    title: String,
    /// Artistes connus ou déduits (principal d'abord) ; vide si inconnu.
    artists: Vec<String>,
    album: String,
    duration_s: f64,
    /// Artiste issu des tags : l'endpoint exact de lrclib a une chance de répondre.
    tagged: bool,
    version: Vec<&'static str>,
}

impl Query {
    /// Hypothèses artiste/titre, de la plus fiable à la plus spéculative.
    fn variants(title: &str, artist: &str, album: &str, path: &str, duration_ms: u64) -> Vec<Query> {
        let tag_artist = usable_artist(artist);
        let unknown_album = album.trim().is_empty() || album == "Album inconnu" || album.contains("www.") || album.contains("Www.");
        let album = if unknown_album { String::new() } else { album.to_string() };
        let duration_s = duration_ms as f64 / 1000.0;
        let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("");

        // Le titre du scanner perd parfois les chiffres de tête (« 2Pac » → « Pac ») : le nom de fichier aussi.
        let mut raws: Vec<String> = Vec::new();
        for raw in [title, stem] {
            let decoded = strip_track_number(&url_decode(raw));
            if !decoded.trim().is_empty() && !raws.iter().any(|r| compact(r) == compact(&decoded)) {
                raws.push(decoded);
            }
        }

        let mut out: Vec<Query> = Vec::new();
        let mut push = |artists: Vec<String>, raw_title: &str, tagged: bool| {
            let version = version_markers(raw_title);
            let title = clean(raw_title);
            if title.is_empty() {
                return;
            }
            let artists: Vec<String> = artists.into_iter().filter(|a| !a.is_empty()).collect();
            if out.iter().any(|q: &Query| compact(&q.title) == compact(&title) && q.artists == artists) {
                return;
            }
            out.push(Query { title, artists, album: album.clone(), duration_s, tagged, version });
        };

        for raw in &raws {
            let parts = split_dash(raw);
            if let Some(a) = &tag_artist {
                // Titre de la forme « Artiste - Titre » alors que l'artiste est déjà tagué.
                if parts.len() >= 2 && artist_similarity(&split_artists(parts[0]), a) >= 0.99 {
                    push(split_artists(a), &parts[1..].join(" - "), true);
                }
                push(split_artists(a), raw, true);
            }
            if parts.len() >= 2 {
                // « Artiste - Titre - bonus » : les deux premiers segments comptent.
                let mut artists = split_artists(parts[0]);
                // Invités cités dans le titre (« Titre feat. X ») : utiles pour reconnaître l'artiste.
                artists.extend(featured(parts[1]));
                push(artists, parts[1], false);
            } else if tag_artist.is_none() {
                let mut artists = Vec::new();
                artists.extend(featured(raw));
                push(artists, raw, false);
            }
        }
        out
    }

    fn text(&self) -> String {
        format!("{} {}", self.artists.first().map(String::as_str).unwrap_or(""), self.title).trim().to_string()
    }
}

fn usable_artist(artist: &str) -> Option<String> {
    let a = artist.trim();
    let lower = a.to_lowercase();
    if a.is_empty() || ["artiste inconnu", "<unknown>", "unknown", "unknown artist", "various artists"].contains(&lower.as_str()) {
        return None;
    }
    // Chaînes YouTube : « LaFouineVEVO », « Booba - Topic ».
    let mut a = a.to_string();
    for suffix in ["VEVO", "Vevo", " - Topic", " Official", " officiel"] {
        if let Some(s) = a.strip_suffix(suffix) {
            a = s.trim().to_string();
        }
    }
    (!a.is_empty()).then_some(a)
}

/// « 11-R.I.P.-Pop-Smoke » → « R.I.P.-Pop-Smoke », « 08 Laissez-moi » → « Laissez-moi ».
fn strip_track_number(s: &str) -> String {
    let t = s.trim();
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if (1..=2).contains(&digits) {
        let rest = &t[digits..];
        // « 2 Chainz », « 50 Cent » : un espace ne sépare un numéro que s'il commence par 0 (« 08 Titre »).
        let sep_ok = |c: char| ['-', '.', '_'].contains(&c) || c == ' ' && t.starts_with('0');
        if let Some(r) = rest.strip_prefix(sep_ok) {
            let r = r.trim_start_matches([' ', '-', '.']);
            if r.chars().next().is_some_and(|c| c.is_alphabetic()) {
                return r.to_string();
            }
        }
    }
    t.to_string()
}

/// « Chris Brown, Tyga », « Central Cee & Dave », « A feat. B », « A x B ».
fn split_artists(s: &str) -> Vec<String> {
    let lower = s.to_lowercase();
    let mut seps: Vec<(usize, usize)> = Vec::new();
    for sep in [",", " & ", " x ", " × ", " feat. ", " feat ", " ft. ", " ft ", " featuring ", " avec ", " vs ", " vs. ", "   ", "  ", " / "] {
        let mut from = 0;
        while let Some(i) = lower[from..].find(sep) {
            seps.push((from + i, sep.len()));
            from += i + sep.len();
        }
    }
    seps.sort();
    let mut out = Vec::new();
    let mut start = 0;
    for (i, len) in seps {
        if i < start {
            continue;
        }
        out.push(&s[start..i]);
        start = i + len;
    }
    out.push(&s[start..]);
    out.into_iter().map(clean).filter(|a| !a.is_empty()).collect()
}

fn featured(title: &str) -> Vec<String> {
    let lower = title.to_lowercase();
    for key in [" feat. ", " feat ", " ft. ", " ft ", " featuring ", "(feat. ", "(ft. "] {
        if let Some(i) = lower.find(key) {
            let rest = &title[i + key.len()..];
            let rest = rest.split(|c| c == ')' || c == ']' || c == '(').next().unwrap_or("");
            return split_artists(rest);
        }
    }
    Vec::new()
}

fn version_markers(s: &str) -> Vec<&'static str> {
    let lower = s.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    ["live", "remix", "acoustic", "acoustique", "instrumental", "karaoke", "sped up", "slowed", "extended", "demo", "translation", "traduction", "romanized"]
        .into_iter()
        .filter(|marker| {
            let marker_words: Vec<&str> = marker.split_whitespace().collect();
            words.windows(marker_words.len()).any(|window| window == marker_words)
        })
        .collect()
}

fn split_dash(s: &str) -> Vec<&str> {
    // « - », « – », « — » entourés d'espaces (« Jay-Z » reste entier).
    let mut out = Vec::new();
    let mut rest = s;
    loop {
        let found = [" - ", " – ", " — "]
            .iter()
            .filter_map(|sep| rest.find(sep).map(|i| (i, sep.len())))
            .min();
        match found {
            Some((i, len)) => {
                let part = rest[..i].trim();
                if !part.is_empty() {
                    out.push(part);
                }
                rest = &rest[i + len..];
            }
            None => {
                if !rest.trim().is_empty() {
                    out.push(rest.trim());
                }
                return out;
            }
        }
    }
}

fn url_decode(s: &str) -> String {
    let s = if !s.contains(' ') { s.replace('+', " ") } else { s.to_string() };
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    let s = String::from_utf8_lossy(&out).replace('_', " ");
    // « Numérologie-feat.-Stavo » : slug sans espaces.
    if !s.trim().contains(' ') { s.replace('-', " ") } else { s }
}

/// Retire tout ce qui n'appartient pas au titre : (…), […], « Clip officiel », « feat. X », « (256k) »…
fn clean(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' | '{' | '【' => depth += 1,
            ')' | ']' | '}' | '】' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let lower = out.to_lowercase();
    let mut cut = out.len();
    const NOISE: [&str; 28] = [
        " feat.", " feat ", " ft.", " ft ", " featuring ", " prod.", " prod ", " @",
        "clip officiel", "clip vidéo", "clip video", "official music video", "official video", "official audio",
        "official lyric", "official clip", "music video", "lyric video", "lyrics video", "audio officiel", "vidéo officielle",
        "visualizer", "visualiser", "paroles lyrics", "audio visualizer", "wshh exclusive", " x ", " × ",
    ];
    for n in NOISE {
        if let Some(i) = lower.find(n) {
            // « x » ne coupe que s'il reste un titre devant.
            if (n == " x " || n == " × ") && i < 2 {
                continue;
            }
            cut = cut.min(i);
        }
    }
    let kept: String = out[..floor_char(&out, cut)].to_string();
    let kept: String = kept
        .chars()
        .map(|c| if c.is_alphanumeric() || " '’&.!?$-".contains(c) { c } else { ' ' })
        .collect();
    let mut words: Vec<&str> = kept.split_whitespace().collect();
    // Reliquats de téléchargement : « 00 », « 360p », « 256k », « audio », « 2025 », « -1 ».
    while let Some(last) = words.last() {
        let l = last.to_lowercase();
        let digits = |t: &str| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit());
        let junk = words.len() > 1
            && (l.starts_with('0') && digits(&l)
                || l.ends_with('k') && digits(&l[..l.len() - 1])
                || l.ends_with('p') && digits(&l[..l.len() - 1])
                || l.len() == 4 && digits(&l) && (l.starts_with("19") || l.starts_with("20"))
                || l.starts_with('-') && digits(&l[1..])
                || ["audio", "hd", "4k", "lyrics", "paroles", "officiel", "official", "clip", "video", "vidéo", "-", "new", "mc"].contains(&l.as_str()));
        if !junk {
            break;
        }
        words.pop();
    }
    words.join(" ").trim_matches(|c: char| c == '-' || c == '.' || c == ' ').trim().to_string()
}

fn floor_char(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn fold(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => "a",
        'æ' => "ae",
        'ç' | 'ć' | 'č' => "c",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
        'ñ' | 'ń' => "n",
        'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' => "o",
        'œ' => "oe",
        'ß' => "ss",
        'ş' | 'š' | 'ś' => "s",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => "u",
        'ÿ' | 'ý' => "y",
        'ž' | 'ź' | 'ż' => "z",
        _ => return None,
    })
}

/// Minuscules, sans accents ni ponctuation, découpé en mots.
fn tokens(s: &str) -> Vec<String> {
    let mut folded = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        if let Some(f) = fold(c) {
            folded.push_str(f);
        } else if c == '$' {
            folded.push('s'); // « A$AP »
        } else if c.is_alphanumeric() {
            folded.push(c);
        } else if c == '\'' || c == '’' || c == '.' {
            // « Don't » → « dont », « R.I.P. » → « rip ».
        } else {
            folded.push(' ');
        }
    }
    folded
        .split_whitespace()
        .filter(|w| !["and", "et", "the", "le", "la", "les", "a"].contains(w))
        .map(String::from)
        .collect()
}

fn compact(s: &str) -> String {
    tokens(s).concat()
}

fn same_word(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let (la, lb) = (a.chars().count(), b.chars().count());
    // « 2pac » / « pac », « gims » / « maitre gims » ; les mots courts doivent être identiques.
    if la >= 3 && lb >= 3 && (a.contains(b) || b.contains(a)) && la.abs_diff(lb) <= 2 {
        return true;
    }
    la >= 5 && lb >= 5 && levenshtein(a, b) <= 1
}

fn levenshtein(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + (ca != *cb) as usize).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

/// Part des mots de `needle` présents dans `hay` (0‥1).
fn coverage(needle: &str, hay: &str) -> f64 {
    let n = tokens(needle);
    if n.is_empty() {
        return 0.0;
    }
    let h = tokens(hay);
    let hit = n.iter().filter(|w| h.iter().any(|x| same_word(w, x))).count();
    hit as f64 / n.len() as f64
}

/// Au moins un des artistes cherchés correspond à l'artiste du résultat (0‥1).
fn artist_similarity(wanted: &[String], cand: &str) -> f64 {
    let cand_compact = compact(cand);
    if cand_compact.is_empty() {
        return 0.0;
    }
    let cand_main = split_artists(cand).into_iter().next().unwrap_or_default();
    let all_wanted = wanted.join(" ");
    wanted
        .iter()
        .map(|a| {
            let ac = compact(a);
            // « LaFouine » / « La Fouine », « Booba, Kalash » contient « Booba ».
            if ac.len() >= 3 && (cand_compact.contains(&ac) || (ac.contains(&cand_compact) && cand_compact.len() >= 3)) {
                return 1.0;
            }
            coverage(a, cand)
        })
        .fold(0.0, f64::max)
        .max(if cand_main.is_empty() { 0.0 } else { coverage(&cand_main, &all_wanted) })
}

// ---------- notation ----------

/// Note un résultat : titre et artiste doivent correspondre, la durée départage.
fn score(q: &Query, cand_title: &str, cand_artist: &str, dur: f64) -> Option<f64> {
    // lrclib a beaucoup d'entrées « Davido - If » : on retire l'artiste du titre.
    let parts = split_dash(cand_title);
    let cand_title = if parts.len() >= 2 && (artist_similarity(&[parts[0].to_string()], cand_artist) >= 0.99 || artist_similarity(&q.artists, parts[0]) >= 0.99) {
        parts[1..].join(" - ")
    } else {
        cand_title.to_string()
    };
    if version_markers(&cand_title) != q.version {
        return None;
    }
    let ct = clean(&cand_title);
    if ct.is_empty() {
        return None;
    }
    let diff = if dur > 0.0 && q.duration_s > 0.0 { (dur - q.duration_s).abs() } else { f64::NAN };
    let close = |limit: f64| diff.is_nan() || diff <= limit;

    let t = coverage(&q.title, &ct);
    let back = coverage(&ct, &q.title);
    let a = if q.artists.is_empty() { 0.0 } else { artist_similarity(&q.artists, cand_artist) };
    let title_words = tokens(&ct).len();

    let base = if !q.artists.is_empty() {
        if t >= 0.85 && back >= 0.75 && a >= 0.66 {
            t * 40.0 + back * 20.0 + a * 30.0
        } else if t >= 0.99 && back >= 0.99 && close(2.0) && !diff.is_nan() && title_words >= 2 {
            // Artiste mal déduit du nom de fichier mais titre et durée identiques.
            60.0
        } else {
            return None;
        }
    } else {
        // Artiste inconnu : le nom contient peut-être « Artiste Titre » sans tiret (« Akon Lonely »).
        let all = coverage(&q.title, &format!("{cand_artist} {ct}"));
        let artist_in_query = coverage(cand_artist, &q.title) >= 0.99;
        if all < 0.99 || back < 0.99 {
            return None;
        }
        if artist_in_query && close(20.0) {
            80.0
        } else if close(3.0) && !diff.is_nan() && (title_words >= 2 || close(1.5)) {
            55.0
        } else {
            return None;
        }
    };
    let diff = if diff.is_nan() { 30.0 } else { diff };
    let exact = if diff <= EXACT_SYNC_S.max(q.duration_s * 0.02) { 15.0 } else { 0.0 };
    Some(base + exact - diff.min(120.0) * 0.3)
}

// ---------- sources ----------

/// Résultat brut d'une source.
#[derive(Clone, Debug)]
struct Hit {
    title: String,
    artist: String,
    album: String,
    duration_s: f64,
    synced: Option<String>,
    plain: Option<String>,
    instrumental: bool,
    source: &'static str,
    /// Identifiant ou URL pour récupérer les paroles (NetEase, Genius).
    key: String,
}

struct Candidate {
    hit: Hit,
    score: f64,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .user_agent("Aura/0.2 (https://github.com/Abdoul273/aura)")
        .build()
        .into()
}

fn best_score(queries: &[Query], h: &Hit) -> Option<f64> {
    queries
        .iter()
        .enumerate()
        // Les hypothèses les plus fiables passent devant à égalité.
        .filter_map(|(i, q)| score(q, &h.title, &h.artist, h.duration_s).map(|s| s - i as f64))
        .max_by(|a, b| a.total_cmp(b))
}

fn fetch_online(queries: &[Query]) -> Result<Option<Value>, String> {
    let agent = agent();
    let hits: Mutex<Vec<Hit>> = Mutex::new(Vec::new());
    let netease_hits: Mutex<Vec<Hit>> = Mutex::new(Vec::new());
    let reached = std::sync::atomic::AtomicBool::new(false);
    let ok = |r: Result<Vec<Hit>, String>, into: &Mutex<Vec<Hit>>| {
        if let Ok(found) = r {
            reached.store(true, std::sync::atomic::Ordering::Relaxed);
            into.lock().unwrap().extend(found);
        }
    };

    // Toutes les sources et toutes les hypothèses en parallèle.
    std::thread::scope(|s| {
        let mut searched = std::collections::HashSet::new();
        for q in queries.iter().take(4) {
            let main_artist = q.artists.first().cloned().unwrap_or_default();
            if q.tagged && !main_artist.is_empty() {
                let (agent, ok, hits) = (&agent, &ok, &hits);
                s.spawn(move || ok(lrclib_get(agent, q), hits));
            }
            let mut plans: Vec<Vec<(&'static str, String)>> = vec![vec![("q", q.text())]];
            if !main_artist.is_empty() {
                plans.push(vec![("track_name", q.title.clone()), ("artist_name", main_artist.clone())]);
            }
            plans.push(vec![("track_name", q.title.clone())]);
            for plan in plans {
                if searched.insert(format!("{plan:?}").to_lowercase()) {
                    let (agent, ok, hits) = (&agent, &ok, &hits);
                    s.spawn(move || ok(lrclib_search(agent, &plan), hits));
                }
            }
            let text = q.text();
            if searched.insert(format!("netease:{}", text.to_lowercase())) {
                let (agent, ok, netease_hits) = (&agent, &ok, &netease_hits);
                s.spawn(move || ok(netease_search(agent, &text), netease_hits));
            }
        }
    });

    let mut cands: Vec<Candidate> = score_all(queries, hits.into_inner().unwrap());

    // NetEase : paroles des meilleurs résultats seulement.
    let mut ne = score_all(queries, netease_hits.into_inner().unwrap());
    ne.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut ids = std::collections::HashSet::new();
    let top: Vec<Hit> = ne.into_iter().filter(|c| ids.insert(c.hit.key.clone())).take(3).map(|c| c.hit).collect();
    cands.extend(score_all(queries, fetch_netease_lyrics(&agent, top)));

    // Genius (texte brut seulement) quand rien d'autre n'a de paroles.
    if !cands.iter().any(|c| c.hit.synced.is_some() || c.hit.plain.is_some()) {
        let mut found = Vec::new();
        for q in queries.iter().take(3) {
            if let Ok(h) = genius_search(&agent, &q.text()) {
                reached.store(true, std::sync::atomic::Ordering::Relaxed);
                found.extend(h);
            }
        }
        let mut g = score_all(queries, found);
        g.sort_by(|a, b| b.score.total_cmp(&a.score));
        let mut urls = std::collections::HashSet::new();
        let top: Vec<Hit> = g.into_iter().filter(|c| urls.insert(c.hit.key.clone())).take(2).map(|c| c.hit).collect();
        cands.extend(score_all(queries, fetch_genius_lyrics(&agent, top)));
    }

    if !reached.into_inner() {
        return Err("réseau indisponible".into());
    }
    Ok(pick(queries[0].duration_s, &cands))
}

fn score_all(queries: &[Query], hits: Vec<Hit>) -> Vec<Candidate> {
    hits.into_iter().filter_map(|hit| Some(Candidate { score: best_score(queries, &hit)?, hit })).collect()
}

/// Meilleur candidat : synchronisé à la bonne durée › synchronisé approximatif › texte brut › instrumental.
fn pick(track_s: f64, cands: &[Candidate]) -> Option<Value> {
    let diff = |c: &Candidate| if c.hit.duration_s > 0.0 && track_s > 0.0 { (c.hit.duration_s - track_s).abs() } else { 0.0 };
    let usable_sync = |c: &Candidate| c.hit.synced.as_deref().is_some_and(|t| matches!(from_text(t, ""), Some(Lyrics::Synced { ref lines, .. }) if lines.len() >= 3));
    let best_by = |f: &dyn Fn(&Candidate) -> bool, key: &dyn Fn(&Candidate) -> f64| {
        cands.iter().filter(|c| f(c)).max_by(|a, b| key(a).total_cmp(&key(b)))
    };
    let bonus = |c: &Candidate| if c.hit.source == "LRCLIB" { 3.0 } else { 0.0 };

    if let Some(c) = best_by(&|c| usable_sync(c) && exact_duration(track_s, c.hit.duration_s), &|c| c.score + bonus(c)) {
        return Some(json!({ "text": c.hit.synced, "source": c.hit.source, "synced": true }));
    }
    if let Some(c) = best_by(&|c| usable_sync(c) && diff(c) <= APPROX_SYNC_S, &|c| c.score - diff(c) * 2.0 + bonus(c)) {
        return Some(json!({ "text": c.hit.synced, "source": c.hit.source, "synced": true, "approximate": true }));
    }
    if let Some(c) = best_by(&|c| c.hit.plain.is_some() || c.hit.synced.is_some(), &|c| c.score + if c.hit.plain.is_some() { 5.0 } else { 0.0 }) {
        let text = c.hit.plain.clone().or_else(|| c.hit.synced.clone());
        return Some(json!({ "text": text, "source": c.hit.source, "synced": false }));
    }
    best_by(&|c| c.hit.instrumental, &|c| c.score).map(|c| json!({ "instrumental": true, "source": c.hit.source }))
}

// ----- LRCLIB -----

fn lrclib_hit(v: &Value) -> Option<Hit> {
    let s = |k: &str| v[k].as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from);
    Some(Hit {
        title: s("trackName")?,
        artist: s("artistName").unwrap_or_default(),
        album: s("albumName").unwrap_or_default(),
        duration_s: v["duration"].as_f64().unwrap_or(0.0),
        synced: s("syncedLyrics"),
        plain: s("plainLyrics"),
        instrumental: v["instrumental"].as_bool() == Some(true),
        source: "LRCLIB",
        key: v["id"].to_string(),
    })
}

fn lrclib_get(agent: &ureq::Agent, q: &Query) -> Result<Vec<Hit>, String> {
    let mut req = agent
        .get("https://lrclib.net/api/get")
        .query("track_name", &q.title)
        .query("artist_name", q.artists.first().map(String::as_str).unwrap_or(""))
        .query("duration", format!("{}", q.duration_s.round()));
    if !q.album.is_empty() {
        req = req.query("album_name", &q.album);
    }
    let mut r = req.call().map_err(|e| e.to_string())?;
    if r.status() != 200 {
        return Ok(Vec::new());
    }
    let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
    Ok(lrclib_hit(&v).into_iter().collect())
}

/// lrclib renvoie parfois une erreur passagère (5xx, délai) : une seconde tentative suffit en général.
fn lrclib_search(agent: &ureq::Agent, params: &[(&str, String)]) -> Result<Vec<Hit>, String> {
    lrclib_search_once(agent, params).or_else(|_| {
        std::thread::sleep(Duration::from_millis(600));
        lrclib_search_once(agent, params)
    })
}

fn lrclib_search_once(agent: &ureq::Agent, params: &[(&str, String)]) -> Result<Vec<Hit>, String> {
    let mut req = agent.get("https://lrclib.net/api/search");
    for (k, v) in params {
        req = req.query(*k, v);
    }
    let mut r = req.call().map_err(|e| e.to_string())?;
    if r.status() != 200 {
        return Err(format!("lrclib {}", r.status()));
    }
    match r.body_mut().read_json::<Value>().map_err(|e| e.to_string())? {
        Value::Array(items) => Ok(items.iter().filter_map(lrclib_hit).collect()),
        _ => Ok(Vec::new()),
    }
}

// ----- NetEase -----

fn netease_search(agent: &ureq::Agent, text: &str) -> Result<Vec<Hit>, String> {
    let mut r = agent
        .get("https://music.163.com/api/cloudsearch/pc")
        .header("Referer", "https://music.163.com/")
        .header("User-Agent", BROWSER_UA)
        .query("s", text)
        .query("type", "1")
        .query("limit", "15")
        .call()
        .map_err(|e| e.to_string())?;
    let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
    let songs = v["result"]["songs"].as_array().cloned().unwrap_or_default();
    Ok(songs
        .iter()
        .filter_map(|s| {
            let artists = s["ar"].as_array().map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
            Some(Hit {
                title: s["name"].as_str()?.to_string(),
                artist: artists,
                album: s["al"]["name"].as_str().unwrap_or("").to_string(),
                duration_s: s["dt"].as_f64().unwrap_or(0.0) / 1000.0,
                synced: None,
                plain: None,
                instrumental: false,
                source: "NetEase",
                key: s["id"].as_u64()?.to_string(),
            })
        })
        .collect())
}

fn fetch_netease_lyrics(agent: &ureq::Agent, hits: Vec<Hit>) -> Vec<Hit> {
    let out = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for mut h in hits {
            let out = &out;
            s.spawn(move || {
                let Ok(mut r) = agent
                    .get("https://music.163.com/api/song/lyric/v1")
                    .header("Referer", "https://music.163.com/")
                    .header("User-Agent", BROWSER_UA)
                    .query("id", &h.key)
                    .query("cp", "false")
                    .query("lv", "0")
                    .query("kv", "0")
                    .query("tv", "0")
                    .query("rv", "0")
                    .query("yv", "0")
                    .query("ytv", "0")
                    .query("yrv", "0")
                    .call()
                else {
                    return;
                };
                let Ok(v) = r.body_mut().read_json::<Value>() else { return };
                if v["nolyric"].as_bool() == Some(true) || v["pureMusic"].as_bool() == Some(true) {
                    h.instrumental = true;
                    out.lock().unwrap().push(h);
                    return;
                }
                // Mot à mot (yrc) en priorité : synchro bien plus fine que le LRC ligne à ligne.
                let yrc = v["yrc"]["lyric"].as_str().and_then(yrc_to_lrc).filter(|t| matches!(from_text(t, ""), Some(Lyrics::Synced { .. })));
                let text = yrc.unwrap_or_else(|| v["lrc"]["lyric"].as_str().unwrap_or("").trim().to_string());
                if text.is_empty() {
                    return;
                }
                if text.contains("纯音乐，请欣赏") {
                    h.instrumental = true;
                } else if matches!(from_text(&text, ""), Some(Lyrics::Synced { .. })) {
                    h.synced = Some(text);
                } else {
                    h.plain = Some(text);
                }
                out.lock().unwrap().push(h);
            });
        }
    });
    out.into_inner().unwrap()
}

// ----- Genius (texte brut) -----

fn genius_search(agent: &ureq::Agent, text: &str) -> Result<Vec<Hit>, String> {
    let mut r = agent
        .get("https://genius.com/api/search/song")
        .header("User-Agent", BROWSER_UA)
        .query("q", text)
        .query("per_page", "5")
        .call()
        .map_err(|e| e.to_string())?;
    if r.status() != 200 {
        return Err(format!("genius {}", r.status()));
    }
    let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for section in v["response"]["sections"].as_array().into_iter().flatten() {
        for hit in section["hits"].as_array().into_iter().flatten() {
            let res = &hit["result"];
            let (Some(title), Some(url)) = (res["title"].as_str(), res["url"].as_str()) else { continue };
            if res["instrumental"].as_bool() == Some(true) {
                continue;
            }
            out.push(Hit {
                title: title.to_string(),
                artist: res["artist_names"].as_str().or(res["primary_artist"]["name"].as_str()).unwrap_or("").to_string(),
                album: String::new(),
                duration_s: 0.0,
                synced: None,
                plain: None,
                instrumental: false,
                source: "Genius",
                key: url.to_string(),
            });
        }
    }
    Ok(out)
}

fn fetch_genius_lyrics(agent: &ureq::Agent, hits: Vec<Hit>) -> Vec<Hit> {
    let out = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for mut h in hits {
            let out = &out;
            s.spawn(move || {
                let Ok(mut r) = agent.get(&h.key).header("User-Agent", BROWSER_UA).call() else { return };
                let Ok(html) = r.body_mut().read_to_string() else { return };
                if let Some(text) = genius_lyrics(&html) {
                    h.plain = Some(text);
                    out.lock().unwrap().push(h);
                }
            });
        }
    });
    out.into_inner().unwrap()
}

/// Texte des blocs `data-lyrics-container` d'une page Genius, sans l'en-tête ni les pubs.
fn genius_lyrics(html: &str) -> Option<String> {
    const VOID: [&str; 8] = ["br", "img", "hr", "input", "meta", "link", "wbr", "source"];
    let mut out = String::new();
    let mut pos = 0;
    while let Some(i) = html[pos..].find("data-lyrics-container=\"true\"") {
        let start = pos + i;
        let mut j = start + html[start..].find('>')? + 1;
        let mut depth = 1usize;
        let mut skip_below: Option<usize> = None;
        while depth > 0 && j < html.len() {
            let Some(k) = html[j..].find('<') else { break };
            if skip_below.is_none() {
                out.push_str(&html[j..j + k]);
            }
            let tag_start = j + k;
            let Some(end) = html[tag_start..].find('>') else { break };
            let tag = &html[tag_start + 1..tag_start + end];
            j = tag_start + end + 1;
            let closing = tag.starts_with('/');
            let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
            if name == "br" {
                if skip_below.is_none() {
                    out.push('\n');
                }
            } else if VOID.contains(&name.as_str()) || tag.ends_with('/') || name.is_empty() {
                // élément vide ou commentaire
            } else if closing {
                depth -= 1;
                if skip_below.is_some_and(|d| depth < d) {
                    skip_below = None;
                }
            } else {
                depth += 1;
                if skip_below.is_none() && tag.contains("data-exclude-from-selection=\"true\"") {
                    skip_below = Some(depth);
                }
            }
        }
        out.push('\n');
        pos = j;
    }
    let text = decode_entities(&out);
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let joined = lines.join("\n");
    // Lignes vides répétées : une seule suffit.
    let mut result = String::new();
    for block in joined.split("\n\n").map(str::trim).filter(|b| !b.is_empty()) {
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(block);
    }
    (tokens(&result).len() >= 8).then_some(result)
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(10)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "nbsp" => Some(' '),
            e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------- analyse LRC ----------

/// Texte LRC synchronisé (y compris « enhanced » <mm:ss.xx>) ou paroles brutes.
pub fn from_text(text: &str, source: &str) -> Option<Lyrics> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return None;
    }
    let mut lines: Vec<LyricsLine> = Vec::new();
    let mut offset_ms: i64 = 0;
    let mut stamped = false;
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
        if stamps.is_empty() {
            continue;
        }
        stamped = true;
        let clean = strip_word_stamps(rest);
        if is_credit(&clean) {
            continue;
        }
        let (words, end) = word_stamps(rest);
        let shift = |ms: i64| (ms - offset_ms).max(0) as u64;
        for ms in stamps {
            // Les mots ne valent que pour la première occurrence d'une ligne répétée ([00:10][00:40]…) : on les décale.
            let delta = words.first().map_or(0, |w| ms - w.0);
            let delta = if is_jitter(delta) { 0 } else { delta };
            lines.push(LyricsLine {
                time_ms: shift(ms),
                text: clean.clone(),
                words: words.iter().map(|(t, w)| LyricsWord { time_ms: shift(t + delta), text: w.clone() }).collect(),
                end_ms: end.map(|e| shift(e + delta)),
            });
        }
    }
    // Horodatage factice (tout à 0) : ce sont des paroles brutes.
    let fake = lines.iter().filter(|l| !l.text.is_empty()).map(|l| l.time_ms).collect::<std::collections::HashSet<_>>().len() <= 1;
    if !stamped || fake {
        let plain: Vec<String> = text
            .lines()
            .map(|l| {
                let mut rest = l.trim();
                while rest.starts_with('[') && rest.find(']').is_some_and(|e| parse_stamp(&rest[1..e]).is_some()) {
                    rest = rest[rest.find(']').unwrap() + 1..].trim_start();
                }
                rest.to_string()
            })
            // En-têtes « [Couplet 1] », « [ar:…] ».
            .filter(|l| !(l.starts_with('[') && l.ends_with(']')) && !is_credit(l))
            .collect();
        let joined = plain.join("\n").trim().to_string();
        return (!joined.is_empty()).then(|| Lyrics::Plain { text: joined, source: source.into() });
    }
    lines.sort_by_key(|l| l.time_ms);
    // Lignes vides consécutives ou en tête : une seule pause suffit ; doublons horodatés retirés.
    let mut out: Vec<LyricsLine> = Vec::with_capacity(lines.len());
    for l in lines {
        let empty = l.text.is_empty();
        if empty && out.last().map_or(true, |p| p.text.is_empty()) {
            continue;
        }
        if out.last().is_some_and(|p| p.time_ms == l.time_ms && p.text == l.text) {
            continue;
        }
        // Lignes JSON de crédits NetEase ({"t":0,"c":[…]}) glissées dans le yrc/lrc.
        if l.text.starts_with("{\"") {
            continue;
        }
        out.push(l);
    }
    while out.last().is_some_and(|l| l.text.is_empty()) {
        out.pop();
    }
    if out.is_empty() {
        return None;
    }
    Some(Lyrics::Synced { lines: out, source: source.into(), approximate: false })
}

/// Un écart de moins d'une seconde entre la ligne et son premier mot est du bruit de saisie, pas une répétition.
fn is_jitter(delta: i64) -> bool {
    delta.abs() < 1000
}

/// Mots d'une ligne LRC enrichie : « <00:01.00>Salut <00:01.50>toi <00:02.10> ».
/// Le dernier horodatage sans texte marque la fin de la ligne.
fn word_stamps(s: &str) -> (Vec<(i64, String)>, Option<i64>) {
    let mut words: Vec<(i64, String)> = Vec::new();
    let mut end = None;
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        let Some(j) = rest[i..].find('>') else { break };
        let Some(ms) = parse_stamp(&rest[i + 1..i + j]) else {
            rest = &rest[i + 1..];
            continue;
        };
        let after = &rest[i + j + 1..];
        let next = after.find('<').unwrap_or(after.len());
        let text = after[..next].to_string();
        if text.trim().is_empty() {
            end = Some(ms);
        } else {
            words.push((ms, text));
            end = None;
        }
        rest = &after[next..];
    }
    // Espaces normalisés comme le texte de la ligne ; un mot sans espace final se colle au suivant.
    let mut out: Vec<(i64, String)> = Vec::with_capacity(words.len());
    for (ms, t) in words {
        let collapsed = t.split_whitespace().collect::<Vec<_>>().join(" ");
        let trailing = t.ends_with(char::is_whitespace) && !collapsed.is_empty();
        let lead = t.starts_with(char::is_whitespace);
        if lead {
            if let Some(prev) = out.last_mut() {
                if !prev.1.ends_with(' ') {
                    prev.1.push(' ');
                }
            }
        }
        if collapsed.is_empty() {
            continue;
        }
        out.push((ms, if trailing { format!("{collapsed} ") } else { collapsed }));
    }
    if let Some(last) = out.last_mut() {
        last.1 = last.1.trim_end().to_string();
    }
    (out, end)
}

/// yrc NetEase (« [12000,2880](12000,390,0)If (12390,180,0)I … ») converti en LRC enrichi.
fn yrc_to_lrc(yrc: &str) -> Option<String> {
    let stamp = |ms: i64| format!("{:02}:{:02}.{:03}", ms / 60_000, (ms / 1000) % 60, ms % 1000);
    let mut out = String::new();
    for line in yrc.lines() {
        let line = line.trim();
        if !line.starts_with('[') {
            continue;
        }
        let Some(close) = line.find(']') else { continue };
        let mut head = line[1..close].split(',');
        let (Some(Ok(start)), Some(Ok(dur))) = (head.next().map(|x| x.trim().parse::<i64>()), head.next().map(|x| x.trim().parse::<i64>())) else { continue };
        let mut body = String::new();
        let mut rest = &line[close + 1..];
        while let Some(i) = rest.find('(') {
            let Some(j) = rest[i..].find(')') else { break };
            let Some(t) = rest[i + 1..i + j].split(',').next().and_then(|x| x.trim().parse::<i64>().ok()) else {
                rest = &rest[i + 1..];
                continue;
            };
            let after = &rest[i + j + 1..];
            let next = after.find('(').unwrap_or(after.len());
            body.push_str(&format!("<{}>{}", stamp(t), &after[..next]));
            rest = &after[next..];
        }
        if body.is_empty() {
            continue;
        }
        out.push_str(&format!("[{}]{}<{}>\n", stamp(start), body, stamp(start + dur)));
    }
    (!out.is_empty()).then_some(out)
}

fn strip_word_stamps(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        match rest[i..].find('>') {
            Some(j) if parse_stamp(&rest[i + 1..i + j]).is_some() => rest = &rest[i + j + 1..],
            _ => {
                out.push('<');
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Crédits glissés dans les paroles (« 作词 : … », « Written by: … »).
fn is_credit(s: &str) -> bool {
    const KEYS: [&str; 20] = [
        "作词", "作曲", "编曲", "制作", "混音", "母带", "录音", "和声", "监制", "出品", "词：", "曲：",
        "Written by", "Composed by", "Produced by", "Lyrics by", "Composer", "Lyricist", "Mixed by", "Mastered by",
    ];
    let head: String = s.chars().take(24).collect();
    (s.contains(':') || s.contains('：')) && KEYS.iter().any(|k| head.contains(k))
}

fn parse_stamp(tag: &str) -> Option<i64> {
    let (m, s) = tag.split_once(':')?;
    let m: i64 = m.trim().parse().ok()?;
    // « 01:02.34 », « 01:02,34 » ou « 01:02:34 ».
    let s = s.trim().replacen(':', ".", 1).replace(',', ".");
    let s: f64 = s.parse().ok()?;
    if !(0.0..60.0).contains(&s) {
        return None;
    }
    Some(m * 60_000 + (s * 1000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first(title: &str, artist: &str, path: &str) -> (String, String) {
        let q = Query::variants(title, artist, "", path, 200_000);
        let q = q.into_iter().find(|q| !q.artists.is_empty()).expect("variante avec artiste");
        (q.artists[0].clone(), q.title)
    }

    #[test]
    fn nettoie_les_noms_de_fichiers() {
        assert_eq!(first("Davido - If  Official Video (256k)", "Artiste inconnu", "/x/a.mp3"), ("Davido".into(), "If".into()));
        assert_eq!(first("Ayra+Starr+-+Rhythm+%26+Blues(128k)", "Artiste inconnu", "/x/a.mp3"), ("Ayra Starr".into(), "Rhythm & Blues".into()));
        assert_eq!(first("CENTRAL CEE FT. LIL BABY - BAND4BAND  MUSIC VIDEO (256k)", "Artiste inconnu", "/x/a.mp3"), ("CENTRAL CEE".into(), "BAND4BAND".into()));
        assert_eq!(first("Aya_Nakamura_-_Fly_(Clip_officiel)(360p)", "Artiste inconnu", "/x/a.mp3"), ("Aya Nakamura".into(), "Fly".into()));
        assert_eq!(first("Love - Part 2", "The Artist", "/x/a.mp3"), ("The Artist".into(), "Love - Part 2".into()));
        // Le titre du scanner a perdu « 2 » : le nom de fichier le rattrape.
        let v = Query::variants("Pac - When It Rains(256k)", "Artiste inconnu", "", "/x/2Pac_-_When_It_Rains(256k).mp3", 265_000);
        assert!(v.iter().any(|q| q.artists.first().map(String::as_str) == Some("2Pac") && q.title == "When It Rains"));
        let v = Query::variants("La Fouine - La fin du monde (Clip officiel)", "LaFouineVEVO", "", "/x/a.m4a", 278_000);
        assert_eq!((v[0].artists[0].as_str(), v[0].title.as_str()), ("LaFouine", "La fin du monde"));
    }

    #[test]
    fn garde_les_mots_horodates() {
        let Some(Lyrics::Synced { lines, .. }) = from_text("[00:01.00]<00:01.00>Salut <00:01.50>toi<00:02.20>\n[00:05.00]Fin", "t") else { panic!() };
        assert_eq!(lines[0].words.iter().map(|w| (w.time_ms, w.text.as_str())).collect::<Vec<_>>(), vec![(1000, "Salut "), (1500, "toi")]);
        assert_eq!(lines[0].end_ms, Some(2200));
        assert!(lines[1].words.is_empty());
        let lrc = yrc_to_lrc("{\"t\":0,\"c\":[{\"tx\":\"作词: \"}]}\n[12000,2880](12000,390,0)If (12390,180,0)I (12570,540,0)tell\n[16260,1290](16260,360,0)My (16620,360,0)mo").unwrap();
        let Some(Lyrics::Synced { lines, .. }) = from_text(&lrc, "t") else { panic!() };
        assert_eq!(lines[0].text, "If I tell");
        assert_eq!(lines[0].words[2].time_ms, 12570);
        assert_eq!(lines[0].end_ms, Some(14880));
    }

    #[test]
    fn lit_le_lrc_enrichi() {
        let Some(Lyrics::Synced { lines, .. }) = from_text("[00:01.00]<00:01.00>Salut <00:01.50>toi\n[00:03.00]\n[00:04:50]Fin", "t") else { panic!() };
        assert_eq!(lines[0].text, "Salut toi");
        assert_eq!(lines[1].text, "");
        assert_eq!(lines[2].time_ms, 4500);
        assert!(matches!(from_text("[00:00.00]a\n[00:00.00]b", "t"), Some(Lyrics::Plain { .. })));
    }

    #[test]
    fn note_les_resultats() {
        let q = &Query::variants("Ma chanson", "Mon artiste", "", "/x/a.mp3", 180_000)[0];
        assert!(score(q, "Ma chanson", "Mon artiste", 180.0).is_some());
        assert!(score(q, "Ma chanson (Live)", "Mon artiste", 180.0).is_none());
        assert!(score(q, "Ma chanson", "Autre artiste", 180.0).is_none());
        // Autre version (clip) : acceptée, mais moins bien notée.
        assert!(score(q, "Ma chanson", "Mon artiste", 194.0).unwrap() < score(q, "Ma chanson", "Mon artiste", 180.0).unwrap());
        // Titre préfixé par l'artiste (lrclib).
        let q = &Query::variants("Davido - If (256k)", "Artiste inconnu", "", "/x/a.mp3", 239_000)[0];
        assert!(score(q, "Davido - If", "Davido", 239.0).is_some());
        // Artiste inconnu, collé au titre.
        let q = &Query::variants("Akon Lonely", "<unknown>", "", "/x/Akon Lonely.mp3", 234_000)[0];
        assert!(score(q, "Lonely", "Akon", 236.0).is_some());
        assert!(score(q, "Lonely", "Someone", 200.0).is_none());
    }

    #[test]
    fn extrait_genius() {
        let html = r#"<div data-lyrics-container="true" class="x"><div data-exclude-from-selection="true"><span>12 Contributors</span></div>[Couplet 1]<br/>Salut l&#x27;ami<br/><i>comment</i> ça va<br/>un deux trois quatre cinq six</div>"#;
        let text = genius_lyrics(html).unwrap();
        assert!(!text.contains("Contributors"));
        assert!(text.contains("Salut l'ami\ncomment ça va"));
    }
}
