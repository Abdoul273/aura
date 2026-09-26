// Contrôleur de lecture : file d'attente, aléatoire/répétition, enchaînement sans blanc
// (le titre suivant est pré-chargé dans la playlist mpv), MPRIS et comptage des écoutes.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now_ms, Db};
use crate::models::*;
use crate::mpv::{Mpv, OBSERVED};
use crate::settings::SettingsStore;

const EQ_FREQS: [u32; 10] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

struct Inner {
    status: String,
    current_track_id: Option<String>,
    position_ms: u64,
    duration_ms: u64,
    volume: f64,
    muted: bool,
    shuffle: bool,
    repeat: String,
    queue: Vec<QueueItem>,
    queue_index: i64,
    history: Vec<String>,
    radio_id: Option<String>,

    uid_seq: u64,
    /// Entrée mpv en cours et entrée pré-chargée (avec l'index de file correspondant).
    cur_entry: Option<i64>,
    next_entry: Option<(i64, usize)>,
    /// Le titre courant n'est pas encore chargé dans mpv (file ajoutée à l'arrêt, fin de file…).
    needs_load: bool,

    listen_track: Option<String>,
    listen_started: i64,
    listened_ms: u64,
    last_pos: Option<f64>,
    last_pos_emit: Instant,
    last_media_update: Instant,

    radio_title: Option<String>,
    audio_params: Value,
    audio_out_params: Value,
    device_list: Value,
    audio_device: String,
    eq: EqState,
    replay_gain: String,
    last_output: Option<OutputStatus>,
}

pub struct Player {
    inner: Mutex<Inner>,
    mpv: Arc<Mpv>,
    db: Arc<Db>,
    settings: Arc<SettingsStore>,
    app: AppHandle,
    cover_dir: PathBuf,
    media: Mutex<Option<MediaControls>>,
}

impl Player {
    pub fn start(app: AppHandle, db: Arc<Db>, settings: Arc<SettingsStore>, cover_dir: PathBuf, socket: PathBuf) -> Result<Arc<Player>, String> {
        let s = settings.get();
        let eq: EqState = db.kv_get("eq").unwrap_or_default();
        let mut args = vec![
            format!("--volume={}", (s.volume * 100.0).round()),
            format!("--replaygain={}", if s.replay_gain == "off" { "no" } else { &s.replay_gain }),
            format!("--gapless-audio={}", if s.gapless { "weak" } else { "no" }),
        ];
        if !s.audio_device.is_empty() {
            args.push(format!("--audio-device={}", s.audio_device));
        }
        let (mpv, events) = Mpv::spawn(socket, &args)?;

        let player = Arc::new(Player {
            inner: Mutex::new(Inner {
                status: "stopped".into(),
                current_track_id: None,
                position_ms: 0,
                duration_ms: 0,
                volume: s.volume,
                muted: false,
                shuffle: false,
                repeat: "off".into(),
                queue: vec![],
                queue_index: -1,
                history: vec![],
                radio_id: None,
                uid_seq: 0,
                cur_entry: None,
                next_entry: None,
                needs_load: false,
                listen_track: None,
                listen_started: 0,
                listened_ms: 0,
                last_pos: None,
                last_pos_emit: Instant::now(),
                last_media_update: Instant::now(),
                radio_title: None,
                audio_params: Value::Null,
                audio_out_params: Value::Null,
                device_list: Value::Null,
                audio_device: if s.audio_device.is_empty() { "auto".into() } else { s.audio_device.clone() },
                eq,
                replay_gain: s.replay_gain.clone(),
                last_output: None,
            }),
            mpv,
            db,
            settings,
            app,
            cover_dir,
            media: Mutex::new(None),
        });
        player.apply_filters(&player.lock());
        player.restore_session();

        let weak = Arc::downgrade(&player);
        std::thread::Builder::new()
            .name("player-events".into())
            .spawn(move || {
                for ev in events {
                    let Some(p) = weak.upgrade() else { break };
                    p.handle_event(ev);
                }
            })
            .map_err(|e| e.to_string())?;

        player.attach_media(Arc::downgrade(&player));
        Ok(player)
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---------- état ----------

    fn snapshot(i: &Inner) -> PlayerState {
        PlayerState {
            status: i.status.clone(),
            current_track_id: i.current_track_id.clone(),
            position_ms: i.position_ms,
            duration_ms: i.duration_ms,
            volume: i.volume,
            muted: i.muted,
            shuffle: i.shuffle,
            repeat: i.repeat.clone(),
            queue: i.queue.clone(),
            queue_index: i.queue_index,
            history: i.history.clone(),
            radio_id: i.radio_id.clone(),
        }
    }

    pub fn state(&self) -> PlayerState {
        Self::snapshot(&self.lock())
    }

    fn emit_state(&self, i: &Inner) {
        let _ = self.app.emit("player:state", Self::snapshot(i));
        self.update_media(i);
        self.save_session(i);
    }

    /// File et position retrouvées au prochain lancement (sans relancer la lecture).
    fn save_session(&self, i: &Inner) {
        if i.radio_id.is_some() {
            return;
        }
        let ids: Vec<&str> = i.queue.iter().map(|q| q.track_id.as_str()).collect();
        self.db.kv_set("session", &json!({ "queue": ids, "index": i.queue_index, "position": i.position_ms, "shuffle": i.shuffle, "repeat": i.repeat }));
    }

    fn restore_session(&self) {
        let Some(v) = self.db.kv_get::<Value>("session") else { return };
        let mut i = self.lock();
        let ids: Vec<String> = v["queue"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let ids: Vec<String> = ids.into_iter().filter(|id| self.db.track_brief(id).is_some()).collect();
        i.shuffle = v["shuffle"].as_bool().unwrap_or(false);
        i.repeat = v["repeat"].as_str().unwrap_or("off").to_string();
        if ids.is_empty() {
            return;
        }
        i.queue = ids.iter().map(|t| QueueItem { uid: format!("q{}", { i.uid_seq += 1; i.uid_seq }), track_id: t.clone() }).collect();
        let idx = v["index"].as_i64().unwrap_or(0).clamp(0, i.queue.len() as i64 - 1);
        i.queue_index = idx;
        let tid = i.queue[idx as usize].track_id.clone();
        i.duration_ms = self.db.track_brief(&tid).map(|b| b.duration_ms).unwrap_or(0);
        i.position_ms = v["position"].as_u64().unwrap_or(0).min(i.duration_ms);
        i.current_track_id = Some(tid);
        i.status = "paused".into();
        i.needs_load = true;
    }

    // ---------- chargement ----------

    fn new_uid(i: &mut Inner) -> String {
        i.uid_seq += 1;
        format!("q{}", i.uid_seq)
    }

    fn next_index(i: &Inner) -> Option<usize> {
        let len = i.queue.len();
        if len == 0 || i.queue_index < 0 {
            return None;
        }
        let n = i.queue_index as usize + 1;
        if n < len {
            Some(n)
        } else if i.repeat == "all" {
            Some(0)
        } else {
            None
        }
    }

    /// Charge le titre courant de la file dans mpv, depuis `start_ms`.
    fn load_current(&self, i: &mut Inner, start_ms: u64, paused: bool) {
        self.finalize_listen(i);
        let Some(item) = i.queue.get(i.queue_index.max(0) as usize).cloned() else {
            self.stop_inner(i);
            return;
        };
        let Some(brief) = self.db.track_brief(&item.track_id) else {
            // Fichier disparu : on le retire et on passe au suivant.
            i.queue.remove(i.queue_index as usize);
            if i.queue_index as usize >= i.queue.len() {
                i.queue_index = i.queue.len() as i64 - 1;
            }
            return self.load_current(i, 0, paused);
        };
        i.radio_id = None;
        i.radio_title = None;
        i.current_track_id = Some(item.track_id.clone());
        i.duration_ms = brief.duration_ms;
        i.position_ms = start_ms;
        i.status = if paused { "paused" } else { "playing" }.into();
        i.needs_load = false;
        i.last_pos = None;
        i.listen_track = Some(item.track_id.clone());
        i.listen_started = now_ms();
        i.listened_ms = 0;

        self.mpv.set("pause", json!(paused));
        self.mpv.set("loop-file", json!(if i.repeat == "one" { "inf" } else { "no" }));
        i.cur_entry = self.mpv.loadfile(&brief.path, "replace", start_ms);
        self.queue_next(i);
    }

    /// Pré-charge le titre suivant dans la playlist mpv (enchaînement sans blanc).
    fn queue_next(&self, i: &mut Inner) {
        i.next_entry = None;
        if i.radio_id.is_some() || i.needs_load || i.cur_entry.is_none() {
            return;
        }
        self.mpv.send(json!(["playlist-clear"]));
        if i.repeat == "one" {
            return;
        }
        if let Some(n) = Self::next_index(i) {
            if let Some(b) = self.db.track_brief(&i.queue[n].track_id) {
                if let Some(id) = self.mpv.loadfile(&b.path, "append", 0) {
                    i.next_entry = Some((id, n));
                }
            }
        }
    }

    fn stop_inner(&self, i: &mut Inner) {
        self.finalize_listen(i);
        self.mpv.send(json!(["stop"]));
        i.status = "stopped".into();
        i.current_track_id = None;
        i.queue_index = -1;
        i.position_ms = 0;
        i.duration_ms = 0;
        i.cur_entry = None;
        i.next_entry = None;
    }

    fn finalize_listen(&self, i: &mut Inner) {
        if let Some(tid) = i.listen_track.take() {
            let threshold = 30_000u64.min(i.duration_ms / 2).max(5_000);
            if i.listened_ms >= threshold {
                self.db.record_play(&tid, i.listen_started, i.listened_ms);
                let _ = self.app.emit("library:played", json!({ "trackId": tid, "listenedMs": i.listened_ms }));
            }
        }
        i.listened_ms = 0;
    }

    fn shuffle_keep_current(i: &mut Inner) {
        if i.queue.len() < 2 {
            return;
        }
        let cur = if i.queue_index >= 0 { Some(i.queue.remove(i.queue_index as usize)) } else { None };
        // Fisher–Yates avec un petit xorshift (pas besoin d'une dépendance pour ça).
        let mut seed = now_ms() as u64 | 1;
        for k in (1..i.queue.len()).rev() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            i.queue.swap(k, (seed % (k as u64 + 1)) as usize);
        }
        if let Some(c) = cur {
            i.queue.insert(0, c);
            i.queue_index = 0;
        }
    }

    // ---------- commandes ----------

    pub fn play(&self, track_ids: Vec<String>, start_index: usize) {
        let mut i = self.lock();
        if track_ids.is_empty() {
            return;
        }
        i.queue = track_ids.into_iter().map(|t| QueueItem { uid: Self::new_uid(&mut i), track_id: t }).collect();
        i.queue_index = start_index.min(i.queue.len() - 1) as i64;
        if i.shuffle {
            Self::shuffle_keep_current(&mut i);
        }
        self.load_current(&mut i, 0, false);
        self.emit_state(&i);
    }

    pub fn pause(&self) {
        let mut i = self.lock();
        if i.status == "playing" {
            self.mpv.set("pause", json!(true));
            i.status = "paused".into();
            self.emit_state(&i);
        }
    }

    pub fn resume(&self) {
        let mut i = self.lock();
        if i.radio_id.is_some() {
            self.mpv.set("pause", json!(false));
            i.status = "playing".into();
        } else if i.current_track_id.is_some() {
            if i.needs_load {
                let pos = if i.position_ms + 1000 >= i.duration_ms { 0 } else { i.position_ms };
                self.load_current(&mut i, pos, false);
            } else {
                self.mpv.set("pause", json!(false));
                i.status = "playing".into();
            }
        } else if !i.queue.is_empty() {
            i.queue_index = 0;
            self.load_current(&mut i, 0, false);
        } else {
            return;
        }
        self.emit_state(&i);
    }

    pub fn toggle(&self) {
        let playing = self.lock().status == "playing";
        if playing { self.pause() } else { self.resume() }
    }

    pub fn next(&self) {
        let mut i = self.lock();
        if i.radio_id.is_some() {
            return;
        }
        let len = i.queue.len();
        if len == 0 {
            return;
        }
        let n = i.queue_index as usize + 1;
        let target = if n < len { n } else if i.repeat == "all" { 0 } else { return };
        if let Some(cur) = i.current_track_id.clone() {
            i.history.push(cur);
        }
        i.queue_index = target as i64;
        self.load_current(&mut i, 0, false);
        self.emit_state(&i);
    }

    pub fn previous(&self) {
        let mut i = self.lock();
        if i.radio_id.is_some() {
            return;
        }
        if i.position_ms > 4000 || i.queue_index <= 0 {
            drop(i);
            return self.seek(0);
        }
        i.queue_index -= 1;
        self.load_current(&mut i, 0, false);
        self.emit_state(&i);
    }

    pub fn seek(&self, ms: u64) {
        let mut i = self.lock();
        let ms = if i.duration_ms > 0 { ms.min(i.duration_ms) } else { ms };
        i.position_ms = ms;
        i.last_pos = None;
        if i.needs_load {
            // Lecteur à l'arrêt avec session restaurée : on mémorise la position.
        } else {
            self.mpv.send(json!(["seek", ms as f64 / 1000.0, "absolute+exact"]));
        }
        let _ = self.app.emit("player:position", ms);
        self.emit_state(&i);
    }

    pub fn set_volume(&self, v: f64) {
        let v = v.clamp(0.0, 1.0);
        let mut i = self.lock();
        i.volume = v;
        if v > 0.0 && i.muted {
            i.muted = false;
            self.mpv.set("mute", json!(false));
        }
        self.mpv.set("volume", json!(v * 100.0));
        self.settings.modify(|s| s.volume = v);
        self.emit_state(&i);
        self.refresh_output(&mut i);
    }

    pub fn set_muted(&self, m: bool) {
        let mut i = self.lock();
        i.muted = m;
        self.mpv.set("mute", json!(m));
        self.emit_state(&i);
        self.refresh_output(&mut i);
    }

    pub fn set_shuffle(&self, s: bool) {
        let mut i = self.lock();
        i.shuffle = s;
        if s {
            Self::shuffle_keep_current(&mut i);
        }
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    pub fn set_repeat(&self, mode: String) {
        let mut i = self.lock();
        i.repeat = mode;
        self.mpv.set("loop-file", json!(if i.repeat == "one" { "inf" } else { "no" }));
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    // ---------- file d'attente ----------

    pub fn queue_add(&self, track_ids: Vec<String>, at_next: bool) {
        let mut i = self.lock();
        let items: Vec<QueueItem> = track_ids.into_iter().map(|t| QueueItem { uid: Self::new_uid(&mut i), track_id: t }).collect();
        if items.is_empty() {
            return;
        }
        if at_next && i.queue_index >= 0 {
            let at = i.queue_index as usize + 1;
            i.queue.splice(at..at, items);
        } else {
            i.queue.extend(items);
        }
        if i.current_track_id.is_none() && i.radio_id.is_none() {
            i.queue_index = 0;
            let tid = i.queue[0].track_id.clone();
            i.duration_ms = self.db.track_brief(&tid).map(|b| b.duration_ms).unwrap_or(0);
            i.position_ms = 0;
            i.current_track_id = Some(tid);
            i.status = "paused".into();
            i.needs_load = true;
        }
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    pub fn queue_remove(&self, index: usize) {
        let mut i = self.lock();
        if index >= i.queue.len() {
            return;
        }
        i.queue.remove(index);
        let cur = i.queue_index;
        if (index as i64) < cur {
            i.queue_index -= 1;
        } else if index as i64 == cur {
            if i.queue.is_empty() {
                self.stop_inner(&mut i);
            } else {
                i.queue_index = cur.min(i.queue.len() as i64 - 1);
                let paused = i.status != "playing";
                self.load_current(&mut i, 0, paused);
            }
            self.emit_state(&i);
            return;
        }
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    pub fn queue_move(&self, from: usize, to: usize) {
        let mut i = self.lock();
        if from == to || from >= i.queue.len() || to >= i.queue.len() {
            return;
        }
        let item = i.queue.remove(from);
        i.queue.insert(to, item);
        let cur = i.queue_index;
        let (f, t) = (from as i64, to as i64);
        if f == cur {
            i.queue_index = t;
        } else if f < cur && t >= cur {
            i.queue_index -= 1;
        } else if f > cur && t <= cur {
            i.queue_index += 1;
        }
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    pub fn queue_clear(&self) {
        let mut i = self.lock();
        let cur = if i.queue_index >= 0 { i.queue.get(i.queue_index as usize).cloned() } else { None };
        i.queue_index = if cur.is_some() { 0 } else { -1 };
        i.queue = cur.into_iter().collect();
        self.queue_next(&mut i);
        self.emit_state(&i);
    }

    // ---------- radio ----------

    pub fn play_radio(&self, station: &RadioStation) {
        let mut i = self.lock();
        self.finalize_listen(&mut i);
        i.radio_id = Some(station.id.clone());
        i.radio_title = None;
        i.current_track_id = None;
        i.status = "playing".into();
        i.position_ms = 0;
        i.duration_ms = 0;
        i.needs_load = false;
        i.next_entry = None;
        self.mpv.set("loop-file", json!("no"));
        self.mpv.set("pause", json!(false));
        i.cur_entry = self.mpv.loadfile(&station.stream_url, "replace", 0);
        self.mpv.send(json!(["playlist-clear"]));
        self.emit_state(&i);
    }

    pub fn radio_now_playing(&self) -> (Option<String>, Option<String>) {
        let i = self.lock();
        (i.radio_id.clone(), i.radio_title.clone())
    }

    // ---------- audio ----------

    pub fn devices(&self) -> Vec<AudioDevice> {
        let i = self.lock();
        let active = if i.audio_device == "auto" { "pipewire" } else { i.audio_device.as_str() };
        let list = if i.device_list.is_array() { i.device_list.clone() } else { self.mpv.get("audio-device-list").unwrap_or(Value::Null) };
        list.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|d| {
                        let id = d["name"].as_str()?;
                        let desc = d["description"].as_str().unwrap_or(id);
                        let (driver, name) = if id == "pipewire" {
                            ("PipeWire", "Sortie par défaut".to_string())
                        } else if id.starts_with("pipewire/") {
                            ("PipeWire", desc.to_string())
                        } else if id.starts_with("alsa/front:") || id.starts_with("alsa/hdmi:") || id.starts_with("alsa/hw:") {
                            ("ALSA", format!("{} (ALSA direct)", desc.split('/').next().unwrap_or(desc)))
                        } else {
                            return None;
                        };
                        let low = format!("{id} {desc}").to_lowercase();
                        let kind = if low.contains("hdmi") || low.contains("displayport") {
                            "hdmi"
                        } else if low.contains("bluez") || low.contains("bluetooth") {
                            "bluetooth"
                        } else if low.contains("headphone") || low.contains("casque") || low.contains("headset") {
                            "headphones"
                        } else {
                            "speakers"
                        };
                        Some(AudioDevice { id: id.into(), name, kind: kind.into(), active: id == active, driver: driver.into() })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn set_device(&self, id: String) {
        let mut i = self.lock();
        self.mpv.set("audio-device", json!(id));
        i.audio_device = id.clone();
        self.settings.modify(|s| s.audio_device = id);
        self.refresh_output(&mut i);
    }

    pub fn eq(&self) -> EqState {
        self.lock().eq.clone()
    }

    pub fn set_eq(&self, eq: EqState) {
        let mut i = self.lock();
        i.eq = eq;
        self.db.kv_set("eq", &i.eq);
        self.apply_filters(&i);
        self.refresh_output(&mut i);
    }

    fn apply_filters(&self, i: &Inner) {
        let active = i.eq.enabled && (i.eq.preamp != 0.0 || i.eq.bands.iter().any(|g| *g != 0.0));
        if !active {
            self.mpv.set("af", json!(""));
            return;
        }
        let mut chain = vec![format!("volume={}dB", i.eq.preamp)];
        for (f, g) in EQ_FREQS.iter().zip(&i.eq.bands) {
            if *g != 0.0 {
                chain.push(format!("equalizer=f={f}:t=o:w=1:g={g}"));
            }
        }
        self.mpv.set("af", json!(format!("lavfi=[{}]", chain.join(","))));
    }

    pub fn set_replay_gain(&self, mode: String) {
        let mut i = self.lock();
        self.mpv.set("replaygain", json!(if mode == "off" { "no" } else { mode.as_str() }));
        i.replay_gain = mode;
        self.refresh_output(&mut i);
    }

    pub fn set_gapless(&self, on: bool) {
        self.mpv.set("gapless-audio", json!(if on { "weak" } else { "no" }));
    }

    pub fn output_status(&self) -> OutputStatus {
        Self::compute_output(&self.lock())
    }

    fn compute_output(i: &Inner) -> OutputStatus {
        let dev = if i.audio_device == "auto" { "pipewire" } else { i.audio_device.as_str() };
        let driver = if dev.starts_with("alsa") { "ALSA" } else if dev.starts_with("pulse") { "PulseAudio" } else { "PipeWire" };
        let device_name = i
            .device_list
            .as_array()
            .and_then(|a| a.iter().find(|d| d["name"] == dev))
            .and_then(|d| d["description"].as_str())
            .map(|s| if dev == "pipewire" { "Sortie par défaut".to_string() } else { s.to_string() })
            .unwrap_or_else(|| "Sortie par défaut".into());

        let inp = &i.audio_params;
        let out = &i.audio_out_params;
        let fmt_bits = |f: &str| match f {
            "u8" | "u8p" => 8,
            "s16" | "s16p" => 16,
            "s24" | "s24p" => 24,
            "s32" | "s32p" | "float" | "floatp" => 32,
            "double" | "doublep" => 64,
            _ => 16,
        };
        let in_rate = inp["samplerate"].as_u64().unwrap_or(44100) as u32;
        let in_fmt = inp["format"].as_str().unwrap_or("");
        let out_fmt = out["format"].as_str().unwrap_or("");
        let untouched = !(i.eq.enabled && (i.eq.preamp != 0.0 || i.eq.bands.iter().any(|g| *g != 0.0)))
            && i.replay_gain == "off"
            && (i.volume - 1.0).abs() < 1e-6
            && !i.muted
            && out["samplerate"].as_u64() == inp["samplerate"].as_u64()
            && in_fmt == out_fmt
            && !in_fmt.is_empty();
        OutputStatus {
            driver: driver.into(),
            device_name,
            bit_perfect: untouched,
            exclusive: driver == "ALSA",
            sample_rate: in_rate,
            bit_depth: fmt_bits(in_fmt),
        }
    }

    fn refresh_output(&self, i: &mut Inner) {
        let s = Self::compute_output(i);
        if i.last_output.as_ref() != Some(&s) {
            let _ = self.app.emit("audio:output", &s);
            i.last_output = Some(s);
        }
    }

    // ---------- événements mpv ----------

    fn handle_event(&self, ev: Value) {
        let mut i = self.lock();
        match ev["event"].as_str().unwrap_or("") {
            "start-file" => {
                let entry = ev["playlist_entry_id"].as_i64();
                if let (Some(e), Some((next_id, n))) = (entry, i.next_entry) {
                    if e == next_id {
                        // Enchaînement naturel vers le titre pré-chargé.
                        self.finalize_listen(&mut i);
                        if let Some(cur) = i.current_track_id.clone() {
                            i.history.push(cur);
                        }
                        i.queue_index = n as i64;
                        let tid = i.queue[n].track_id.clone();
                        i.duration_ms = self.db.track_brief(&tid).map(|b| b.duration_ms).unwrap_or(0);
                        i.current_track_id = Some(tid.clone());
                        i.position_ms = 0;
                        i.last_pos = None;
                        i.cur_entry = Some(e);
                        i.listen_track = Some(tid);
                        i.listen_started = now_ms();
                        i.status = "playing".into();
                        self.queue_next(&mut i);
                        self.emit_state(&i);
                    }
                }
            }
            "end-file" => {
                let entry = ev["playlist_entry_id"].as_i64();
                let reason = ev["reason"].as_str().unwrap_or("");
                if entry.is_none() || entry != i.cur_entry || i.next_entry.is_some() {
                    return;
                }
                match reason {
                    "eof" if i.radio_id.is_none() => {
                        // Fin de la file : on reste sur le dernier titre, en pause.
                        self.finalize_listen(&mut i);
                        i.status = "paused".into();
                        i.position_ms = i.duration_ms;
                        i.needs_load = true;
                        i.cur_entry = None;
                        self.emit_state(&i);
                    }
                    "error" => {
                        let n = i.queue_index as usize + 1;
                        if i.radio_id.is_none() && n < i.queue.len() {
                            i.queue_index = n as i64;
                            self.load_current(&mut i, 0, false);
                        } else {
                            i.status = "paused".into();
                            i.needs_load = i.radio_id.is_none();
                        }
                        self.emit_state(&i);
                    }
                    _ => {}
                }
            }
            "property-change" => {
                let id = ev["id"].as_u64().unwrap_or(0) as usize;
                let name = OBSERVED.get(id.wrapping_sub(1)).copied().unwrap_or("");
                let data = ev["data"].clone();
                self.on_property(&mut i, name, data);
            }
            _ => {}
        }
    }

    fn on_property(&self, i: &mut Inner, name: &str, data: Value) {
        match name {
            "time-pos" => {
                let Some(pos) = data.as_f64() else { return };
                if i.needs_load {
                    return;
                }
                if i.status == "playing" && i.listen_track.is_some() {
                    if let Some(last) = i.last_pos {
                        let d = pos - last;
                        if d > 0.0 && d < 1.5 {
                            i.listened_ms += (d * 1000.0) as u64;
                        }
                    }
                }
                i.last_pos = Some(pos);
                i.position_ms = (pos * 1000.0) as u64;
                if i.last_pos_emit.elapsed() >= Duration::from_millis(200) {
                    i.last_pos_emit = Instant::now();
                    let _ = self.app.emit("player:position", i.position_ms);
                }
                if i.last_media_update.elapsed() >= Duration::from_secs(1) {
                    i.last_media_update = Instant::now();
                    self.update_playback(i);
                }
            }
            "duration" => {
                if let Some(d) = data.as_f64() {
                    let ms = (d * 1000.0) as u64;
                    if i.radio_id.is_none() && ms > 0 && ms.abs_diff(i.duration_ms) > 1000 {
                        i.duration_ms = ms;
                        self.emit_state(i);
                    }
                }
            }
            "metadata" => {
                if i.radio_id.is_some() {
                    let title = data
                        .as_object()
                        .and_then(|m| m.iter().find(|(k, _)| k.eq_ignore_ascii_case("icy-title")).map(|(_, v)| v.clone()))
                        .and_then(|v| v.as_str().map(String::from))
                        .filter(|s| !s.trim().is_empty());
                    if title != i.radio_title {
                        i.radio_title = title.clone();
                        let _ = self.app.emit("radio:nowplaying", json!({ "id": i.radio_id, "title": title }));
                        self.update_media(i);
                    }
                }
            }
            "audio-params" => {
                i.audio_params = data;
                self.refresh_output(i);
            }
            "audio-out-params" => {
                i.audio_out_params = data;
                self.refresh_output(i);
            }
            "audio-device-list" => {
                i.device_list = data;
                self.refresh_output(i);
            }
            "audio-device" => {
                if let Some(d) = data.as_str() {
                    i.audio_device = d.to_string();
                    self.refresh_output(i);
                }
            }
            _ => {}
        }
    }

    // ---------- MPRIS ----------

    fn attach_media(&self, weak: Weak<Player>) {
        let config = PlatformConfig { dbus_name: "aura", display_name: "Aura", hwnd: None };
        let Ok(mut controls) = MediaControls::new(config) else { return };
        let app = self.app.clone();
        let res = controls.attach(move |ev: MediaControlEvent| {
            let Some(p) = weak.upgrade() else { return };
            // Hors du thread D-Bus : les commandes peuvent attendre mpv.
            std::thread::spawn(move || match ev {
                MediaControlEvent::Play => p.resume(),
                MediaControlEvent::Pause | MediaControlEvent::Stop => p.pause(),
                MediaControlEvent::Toggle => p.toggle(),
                MediaControlEvent::Next => p.next(),
                MediaControlEvent::Previous => p.previous(),
                MediaControlEvent::Seek(dir) => p.seek_by(dir, Duration::from_secs(10)),
                MediaControlEvent::SeekBy(dir, d) => p.seek_by(dir, d),
                MediaControlEvent::SetPosition(MediaPosition(d)) => p.seek(d.as_millis() as u64),
                MediaControlEvent::SetVolume(v) => p.set_volume(v),
                MediaControlEvent::Raise => {
                    if let Some(w) = p.app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                MediaControlEvent::Quit => p.app.exit(0),
                _ => {}
            });
            let _ = &app;
        });
        if res.is_ok() {
            *self.media.lock().unwrap() = Some(controls);
            self.update_media(&self.lock());
        }
    }

    fn seek_by(&self, dir: SeekDirection, d: Duration) {
        let pos = self.lock().position_ms as i64;
        let delta = d.as_millis() as i64;
        let target = match dir {
            SeekDirection::Forward => pos + delta,
            SeekDirection::Backward => pos - delta,
        };
        self.seek(target.max(0) as u64);
    }

    fn update_media(&self, i: &Inner) {
        let mut guard = self.media.lock().unwrap();
        let Some(controls) = guard.as_mut() else { return };
        let brief = i.current_track_id.as_ref().and_then(|t| self.db.track_brief(t));
        if let Some(b) = &brief {
            let cover = self.cover_dir.join(format!("{}.jpg", b.album_id));
            let cover_url = cover.exists().then(|| format!("file://{}", cover.display()));
            let _ = controls.set_metadata(MediaMetadata {
                title: Some(&b.title),
                artist: Some(&b.artist),
                album: Some(&b.album),
                cover_url: cover_url.as_deref(),
                duration: Some(Duration::from_millis(i.duration_ms)),
            });
        } else if let Some(rid) = &i.radio_id {
            let name = self.db.radios().ok().and_then(|r| r.into_iter().find(|s| &s.id == rid)).map(|s| s.name).unwrap_or_default();
            let title = i.radio_title.clone().unwrap_or_else(|| name.clone());
            let _ = controls.set_metadata(MediaMetadata { title: Some(&title), artist: Some(&name), album: Some("Radio"), cover_url: None, duration: None });
        } else {
            let _ = controls.set_metadata(MediaMetadata::default());
        }
        let _ = controls.set_volume(i.volume);
        drop(guard);
        self.update_playback(i);
    }

    fn update_playback(&self, i: &Inner) {
        let mut guard = self.media.lock().unwrap();
        let Some(controls) = guard.as_mut() else { return };
        let progress = Some(MediaPosition(Duration::from_millis(i.position_ms)));
        let pb = match i.status.as_str() {
            "playing" => MediaPlayback::Playing { progress },
            "paused" => MediaPlayback::Paused { progress },
            _ => MediaPlayback::Stopped,
        };
        let _ = controls.set_playback(pb);
    }

    pub fn shutdown(&self) {
        {
            let mut i = self.lock();
            self.finalize_listen(&mut i);
            self.save_session(&i);
        }
        self.mpv.quit();
    }
}
