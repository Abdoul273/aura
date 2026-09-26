// Paroles : .lrc voisin → tag intégré → lrclib.net → NetEase (mis en cache).
//
// Beaucoup de fichiers n'ont pas de tags (rips YouTube : « Davido - If  Official Video (256k) ») :
// on reconstruit artiste/titre depuis le nom, puis on note chaque candidat (titre, artiste, durée)
// pour ne jamais afficher les paroles d'un autre morceau. Des paroles synchronisées dont la durée
// s'écarte trop du fichier seraient décalées : on les rend alors en texte brut.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use lofty::prelude::*;
use serde_json::{json, Value};

use crate::db::Db;
use crate::models::{Lyrics, LyricsLine};

/// Écart de durée au-delà duquel des paroles synchronisées ne sont plus fiables.
const SYNC_TOLERANCE_S: f64 = 12.0;
/// Délai avant de retenter une recherche restée sans résultat.
const RETRY_AFTER: Duration = Duration::from_secs(2 * 24 * 3600);

pub fn get(db: &Db, cache_dir: &Path, track_id: &str, force: bool) -> Option<Lyrics> {
    let brief = db.track_brief(track_id)?;
    let path = Path::new(&brief.path);
    let mut plain_fallback: Option<Lyrics> = None;

    // 1. Fichier .lrc / .txt voisin, puis tag intégré (USLT, LYRICS…).
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
    for text in &local {
        match from_text(text, "Fichier local") {
            Some(l @ Lyrics::Synced { .. }) => return Some(l),
            Some(l) if plain_fallback.is_none() => plain_fallback = Some(l),
            _ => {}
        }
    }

    // 2. Cache des recherches en ligne.
    let _ = std::fs::create_dir_all(cache_dir);
    let cached = cache_dir.join(format!("v2-{track_id}.json"));
    let none_marker = cache_dir.join(format!("v2-{track_id}.none"));
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
    let query = Query::from_track(&brief.title, &brief.artist, &brief.album, &brief.path, brief.duration_ms);
    if query.title.is_empty() {
        return plain_fallback;
    }
    match fetch_online(&query) {
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
    let l = from_text(text, source)?;
    // Paroles synchronisées d'une autre version (durée trop différente) : texte seul.
    if v["synced"].as_bool() == Some(false) {
        if let Lyrics::Synced { lines, source } = l {
            let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
            return Some(Lyrics::Plain { text: text.trim().to_string(), source });
        }
    }
    Some(l)
}

// ---------- requête ----------

struct Query {
    title: String,
    artist: String,
    album: String,
    duration_s: f64,
    /// Tags fiables : l'endpoint exact de lrclib a une chance de répondre.
    tagged: bool,
}

impl Query {
    fn from_track(title: &str, artist: &str, album: &str, path: &str, duration_ms: u64) -> Self {
        let unknown_artist = artist.trim().is_empty() || artist == "Artiste inconnu";
        let unknown_album = album.trim().is_empty() || album == "Album inconnu";
        let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or(title);
        // Sans tags, le nom de fichier complet est plus fiable que le titre déduit au scan.
        let raw_title = if title.trim().is_empty() || unknown_artist { stem } else { title };

        let (mut a, mut t) = (String::new(), String::new());
        let decoded = url_decode(raw_title);
        if unknown_artist || decoded.contains(" - ") {
            // « Artiste - Titre - bonus » : les deux premiers segments comptent.
            let parts: Vec<&str> = split_dash(&decoded);
            if parts.len() >= 2 {
                a = parts[0].to_string();
                t = parts[1].to_string();
            }
        }
        if t.is_empty() {
            t = decoded.clone();
        }
        if a.is_empty() && !unknown_artist {
            a = artist.to_string();
        }
        // Un artiste de tag est plus fiable que celui déduit du nom.
        if !unknown_artist && !decoded.contains(" - ") {
            a = artist.to_string();
        }
        let tagged = !unknown_artist && !decoded.contains(" - ");
        let title = clean(&t);
        let artist = clean(&a);
        Query {
            tagged,
            title,
            artist,
            album: if unknown_album { String::new() } else { album.to_string() },
            duration_s: duration_ms as f64 / 1000.0,
        }
    }

    fn text(&self) -> String {
        format!("{} {}", self.artist, self.title).trim().to_string()
    }
}

fn split_dash(s: &str) -> Vec<&str> {
    // « - », « – », « — » entourés d'espaces (« Jay-Z » reste entier).
    let mut out = Vec::new();
    let mut rest = s;
    loop {
        let found = [" - ", " – ", " — "].iter().filter_map(|sep| rest.find(sep).map(|i| (i, sep.len()))).min();
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
    const NOISE: [&str; 22] = [
        " feat.", " feat ", " ft.", " ft ", " featuring ", " prod.", " prod ",
        "clip officiel", "clip vidéo", "clip video", "official music video", "official video", "official audio",
        "official lyric", "music video", "lyric video", "lyrics video", "audio officiel", "vidéo officielle",
        "visualizer", "visualiser", " x ",
    ];
    for n in NOISE {
        if let Some(i) = lower.find(n) {
            // « x » ne coupe que s'il reste un titre devant.
            if n == " x " && i < 2 {
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
    // Reliquats de téléchargement : « 00 », « 360p », « 256k », « audio ».
    while let Some(last) = words.last() {
        let l = last.to_lowercase();
        let junk = l.starts_with('0') && l.chars().all(|c| c.is_ascii_digit()) && words.len() > 1
            || l.ends_with('k') && l[..l.len() - 1].chars().all(|c| c.is_ascii_digit()) && l.len() > 1
            || l.ends_with('p') && l[..l.len() - 1].chars().all(|c| c.is_ascii_digit()) && l.len() > 1
            || ["audio", "hd", "4k", "lyrics", "paroles", "officiel", "official", "-"].contains(&l.as_str());
        if !junk {
            break;
        }
        words.pop();
    }
    words.join(" ").trim_matches(|c: char| c == '-' || c == '.').trim().to_string()
}

fn floor_char(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Minuscules, sans accents ni ponctuation, découpé en mots.
fn tokens(s: &str) -> Vec<String> {
    let folded: String = s
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ÿ' | 'ý' => 'y',
            '&' => ' ',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    folded.split_whitespace().filter(|w| *w != "and" && *w != "et").map(String::from).collect()
}

/// Part des mots de `needle` présents dans `hay` (0‥1).
fn coverage(needle: &str, hay: &str) -> f64 {
    let n = tokens(needle);
    if n.is_empty() {
        return 0.0;
    }
    let h = tokens(hay);
    let hit = n.iter().filter(|w| h.iter().any(|x| x == *w || (w.len() >= 3 && x.contains(w.as_str())))).count();
    hit as f64 / n.len() as f64
}

// ---------- sources ----------

struct Candidate {
    synced: Option<String>,
    plain: Option<String>,
    instrumental: bool,
    duration_s: f64,
    score: f64,
    source: &'static str,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .user_agent("Aura/0.1 (https://github.com/Abdoul273/aura)")
        .build()
        .into()
}

fn fetch_online(q: &Query) -> Result<Option<Value>, String> {
    let agent = agent();
    let mut cands: Vec<Candidate> = Vec::new();
    let mut reached = false;

    // Correspondance exacte (tags propres).
    if q.tagged && !q.artist.is_empty() {
        let mut req = agent.get("https://lrclib.net/api/get").query("track_name", &q.title).query("artist_name", &q.artist);
        if !q.album.is_empty() {
            req = req.query("album_name", &q.album);
        }
        if let Ok(mut r) = req.query("duration", format!("{}", q.duration_s.round())).call() {
            reached = true;
            if r.status() == 200 {
                if let Ok(v) = r.body_mut().read_json::<Value>() {
                    cands.extend(lrclib_candidate(q, &v));
                }
            }
        }
    }
    if let Some(best) = pick(q, &cands) {
        return Ok(Some(best));
    }

    // Recherches lrclib de plus en plus souples.
    let mut searches: Vec<Vec<(&str, String)>> = Vec::new();
    if !q.artist.is_empty() {
        searches.push(vec![("track_name", q.title.clone()), ("artist_name", q.artist.clone())]);
    }
    searches.push(vec![("q", q.text())]);
    if !q.artist.is_empty() {
        searches.push(vec![("track_name", q.title.clone())]);
    }
    for params in searches {
        let mut req = agent.get("https://lrclib.net/api/search");
        for (k, v) in &params {
            req = req.query(*k, v);
        }
        match req.call() {
            Ok(mut r) => {
                reached = true;
                if r.status() == 200 {
                    if let Ok(Value::Array(items)) = r.body_mut().read_json::<Value>() {
                        cands.extend(items.iter().filter_map(|v| lrclib_candidate(q, v)));
                    }
                }
            }
            Err(_) => {}
        }
        if pick_synced_ok(q, &cands) {
            break;
        }
    }

    // NetEase en secours (très bon catalogue de paroles synchronisées).
    if !pick_synced_ok(q, &cands) {
        match netease(&agent, q) {
            Ok(c) => {
                reached = true;
                cands.extend(c);
            }
            Err(_) => {}
        }
    }

    if !reached {
        return Err("réseau indisponible".into());
    }
    Ok(pick(q, &cands))
}

/// Note un résultat : titre et artiste doivent correspondre, la durée départage.
fn score(q: &Query, cand_title: &str, cand_artist: &str, dur: f64) -> Option<f64> {
    let hay = format!("{cand_artist} {cand_title}");
    let t = coverage(&q.title, &hay);
    // Le titre du candidat ne doit pas être bien plus long (autre morceau, remix…).
    let back = coverage(&clean(cand_title), &format!("{} {}", q.artist, q.title));
    if t < 0.75 || back < 0.5 {
        return None;
    }
    let a = if q.artist.is_empty() { 1.0 } else { coverage(&q.artist, &hay).max(coverage(cand_artist, &q.artist)) };
    if !q.artist.is_empty() && a < 0.5 {
        return None;
    }
    let diff = if dur > 0.0 && q.duration_s > 0.0 { (dur - q.duration_s).abs() } else { 30.0 };
    Some(t * 50.0 + back * 20.0 + a * 30.0 - diff.min(120.0) * 0.8)
}

fn lrclib_candidate(q: &Query, v: &Value) -> Option<Candidate> {
    let s = |k: &str| v[k].as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from);
    let dur = v["duration"].as_f64().unwrap_or(0.0);
    let score = score(q, v["trackName"].as_str()?, v["artistName"].as_str().unwrap_or(""), dur)?;
    Some(Candidate {
        synced: s("syncedLyrics"),
        plain: s("plainLyrics"),
        instrumental: v["instrumental"].as_bool() == Some(true),
        duration_s: dur,
        score,
        source: "LRCLIB",
    })
}

fn netease(agent: &ureq::Agent, q: &Query) -> Result<Vec<Candidate>, String> {
    let mut r = agent
        .get("https://music.163.com/api/search/get")
        .header("Referer", "https://music.163.com/")
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36")
        .query("s", q.text())
        .query("type", "1")
        .query("limit", "10")
        .call()
        .map_err(|e| e.to_string())?;
    let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
    let mut scored: Vec<(f64, u64, f64)> = v["result"]["songs"]
        .as_array()
        .map(|songs| {
            songs
                .iter()
                .filter_map(|s| {
                    let artists = s["artists"].as_array().map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                    let dur = s["duration"].as_f64().unwrap_or(0.0) / 1000.0;
                    let sc = score(q, s["name"].as_str()?, &artists, dur)?;
                    Some((sc, s["id"].as_u64()?, dur))
                })
                .collect()
        })
        .unwrap_or_default();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));

    let mut out = Vec::new();
    for (sc, id, dur) in scored.into_iter().take(2) {
        let mut r = agent
            .get("https://music.163.com/api/song/lyric")
            .header("Referer", "https://music.163.com/")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36")
            .query("id", id.to_string())
            .query("lv", "1")
            .call()
            .map_err(|e| e.to_string())?;
        let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
        let text = v["lrc"]["lyric"].as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        let synced = matches!(from_text(&text, ""), Some(Lyrics::Synced { .. }));
        out.push(Candidate {
            synced: synced.then(|| text.clone()),
            plain: (!synced).then_some(text),
            instrumental: false,
            duration_s: dur,
            score: sc - 5.0, // à égalité, lrclib (souvent vérifié) passe devant
            source: "NetEase",
        });
        break;
    }
    Ok(out)
}

fn sync_fits(q: &Query, c: &Candidate) -> bool {
    c.synced.is_some() && (q.duration_s <= 0.0 || (c.duration_s - q.duration_s).abs() <= SYNC_TOLERANCE_S)
}

fn pick_synced_ok(q: &Query, cands: &[Candidate]) -> bool {
    cands.iter().any(|c| sync_fits(q, c))
}

/// Meilleur candidat : synchronisé à la bonne durée › texte brut › instrumental.
fn pick(q: &Query, cands: &[Candidate]) -> Option<Value> {
    let best_by = |f: &dyn Fn(&Candidate) -> bool| cands.iter().filter(|c| f(c)).max_by(|a, b| a.score.total_cmp(&b.score));
    if let Some(c) = best_by(&|c| sync_fits(q, c)) {
        return Some(json!({ "text": c.synced, "source": c.source, "synced": true }));
    }
    if let Some(c) = best_by(&|c| c.plain.is_some() || c.synced.is_some()) {
        let text = c.plain.clone().or_else(|| c.synced.clone());
        return Some(json!({ "text": text, "source": c.source, "synced": false }));
    }
    best_by(&|c| c.instrumental).map(|c| json!({ "instrumental": true, "source": c.source }))
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
        for ms in stamps {
            lines.push(LyricsLine { time_ms: (ms - offset_ms).max(0) as u64, text: clean.clone() });
        }
    }
    if !stamped {
        let plain: Vec<&str> = text.lines().map(str::trim).filter(|l| !(l.starts_with('[') && l.ends_with(']'))).collect();
        let joined = plain.join("\n").trim().to_string();
        return (!joined.is_empty()).then(|| Lyrics::Plain { text: joined, source: source.into() });
    }
    lines.sort_by_key(|l| l.time_ms);
    // Lignes vides consécutives ou en tête : une seule pause suffit.
    let mut out: Vec<LyricsLine> = Vec::with_capacity(lines.len());
    for l in lines {
        let empty = l.text.is_empty();
        if empty && out.last().map_or(true, |p| p.text.is_empty()) {
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
    Some(Lyrics::Synced { lines: out, source: source.into() })
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

/// Crédits que NetEase glisse dans les paroles (« 作词 : … »).
fn is_credit(s: &str) -> bool {
    const KEYS: [&str; 12] = ["作词", "作曲", "编曲", "制作", "混音", "母带", "录音", "和声", "监制", "出品", "词：", "曲："];
    (s.contains(':') || s.contains('：')) && KEYS.iter().any(|k| s.contains(k))
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

    #[test]
    fn nettoie_les_noms_de_fichiers() {
        let q = Query::from_track("Davido - If  Official Video (256k)", "Artiste inconnu", "Album inconnu", "/x/a.mp3", 239_000);
        assert_eq!((q.artist.as_str(), q.title.as_str()), ("Davido", "If"));
        let q = Query::from_track("Ayra+Starr+-+Rhythm+%26+Blues(128k)", "Artiste inconnu", "", "/x/a.mp3", 150_000);
        assert_eq!((q.artist.as_str(), q.title.as_str()), ("Ayra Starr", "Rhythm & Blues"));
        let q = Query::from_track("CENTRAL CEE FT. LIL BABY - BAND4BAND  MUSIC VIDEO (256k)", "Artiste inconnu", "", "/x/a.mp3", 150_000);
        assert_eq!((q.artist.as_str(), q.title.as_str()), ("CENTRAL CEE", "BAND4BAND"));
        let q = Query::from_track("Aya_Nakamura_-_Fly_(Clip_officiel)(360p)", "Artiste inconnu", "", "/x/a.mp3", 270_000);
        assert_eq!((q.artist.as_str(), q.title.as_str()), ("Aya Nakamura", "Fly"));
    }

    #[test]
    fn lit_le_lrc_enrichi() {
        let Some(Lyrics::Synced { lines, .. }) = from_text("[00:01.00]<00:01.00>Salut <00:01.50>toi\n[00:03.00]\n[00:04:50]Fin", "t") else { panic!() };
        assert_eq!(lines[0].text, "Salut toi");
        assert_eq!(lines[1].text, "");
        assert_eq!(lines[2].time_ms, 4500);
    }
}
