// Client mpv : un processus `mpv --idle` piloté par son socket IPC JSON.
// Le thread lecteur résout les réponses et transmet les événements sur un canal,
// sans jamais toucher à l'état du lecteur (pas d'interblocage possible).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

pub struct Mpv {
    writer: Mutex<UnixStream>,
    pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
    child: Mutex<Child>,
    socket: PathBuf,
}

/// Propriétés observées ; l'identifiant sert à les reconnaître dans les événements.
pub const OBSERVED: &[&str] = &[
    "time-pos",
    "duration",
    "pause",
    "idle-active",
    "metadata",
    "audio-params",
    "audio-out-params",
    "audio-device-list",
    "audio-device",
    "volume",
    "mute",
];

impl Mpv {
    pub fn spawn(socket: PathBuf, extra_args: &[String]) -> Result<(Arc<Mpv>, Receiver<Value>), String> {
        let _ = std::fs::remove_file(&socket);
        let mut cmd = Command::new("mpv");
        cmd.args([
            "--idle=yes",
            "--no-video",
            "--no-config",
            "--no-terminal",
            "--audio-display=no",
            "--audio-client-name=Aura",
            "--gapless-audio=weak",
            "--prefetch-playlist=yes",
            "--volume-max=100",
            "--keep-open=no",
            "--cache=yes",
        ])
        .arg(format!("--input-ipc-server={}", socket.display()))
        .args(extra_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        // mpv meurt avec Aura (fermeture brutale, déconnexion) : sinon il reste
        // orphelin, continue de jouer et garde l'ancienne session ouverte.
        // Lancé depuis le thread principal, qui vit aussi longtemps que l'appli.
        unsafe {
            cmd.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 || libc::getppid() == 1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child = cmd.spawn().map_err(|e| format!("Impossible de lancer mpv : {e}"))?;

        // Attend que le socket soit prêt.
        let mut stream = None;
        for _ in 0..100 {
            if let Ok(s) = UnixStream::connect(&socket) {
                stream = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let stream = stream.ok_or("mpv n'a pas ouvert son socket IPC")?;
        let reader = stream.try_clone().map_err(|e| e.to_string())?;

        let pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>> = Arc::default();
        let (ev_tx, ev_rx) = mpsc::channel();
        {
            let pending = pending.clone();
            std::thread::Builder::new()
                .name("mpv-reader".into())
                .spawn(move || {
                    for line in BufReader::new(reader).lines() {
                        let Ok(line) = line else { break };
                        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                        if let Some(id) = v.get("request_id").and_then(Value::as_u64) {
                            if let Some(tx) = pending.lock().unwrap().remove(&id) {
                                let res = if v["error"] == "success" { Ok(v["data"].clone()) } else { Err(v["error"].to_string()) };
                                let _ = tx.send(res);
                            }
                        } else if v.get("event").is_some() && ev_tx.send(v).is_err() {
                            break;
                        }
                    }
                })
                .map_err(|e| e.to_string())?;
        }

        let mpv = Arc::new(Mpv {
            writer: Mutex::new(stream),
            pending,
            next_id: AtomicU64::new(1),
            child: Mutex::new(child),
            socket,
        });
        for (i, p) in OBSERVED.iter().enumerate() {
            mpv.send(json!(["observe_property", i + 1, p]));
        }
        Ok((mpv, ev_rx))
    }

    /// Commande sans attendre la réponse.
    pub fn send(&self, cmd: Value) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.write(json!({ "command": cmd, "request_id": id }));
    }

    /// Commande avec réponse (délai max 2 s).
    pub fn call(&self, cmd: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.write(json!({ "command": cmd, "request_id": id }));
        let res = rx.recv_timeout(Duration::from_secs(2)).map_err(|_| "mpv ne répond pas".to_string())?;
        self.pending.lock().unwrap().remove(&id);
        res
    }

    fn write(&self, msg: Value) {
        let mut w = self.writer.lock().unwrap();
        let _ = writeln!(w, "{msg}");
    }

    pub fn set(&self, prop: &str, value: Value) {
        self.send(json!(["set_property", prop, value]));
    }

    pub fn get(&self, prop: &str) -> Option<Value> {
        self.call(json!(["get_property", prop])).ok()
    }

    /// Ajoute un fichier (éventuellement à partir de `start_ms`) ; renvoie l'identifiant d'entrée mpv.
    pub fn loadfile(&self, path: &str, mode: &str, start_ms: u64) -> Option<i64> {
        let cmd = if start_ms > 0 {
            json!(["loadfile", path, mode, -1, format!("start={}", start_ms as f64 / 1000.0)])
        } else {
            json!(["loadfile", path, mode])
        };
        self.call(cmd)
            .ok()
            .and_then(|v| v.get("playlist_entry_id").and_then(Value::as_i64))
    }

    pub fn quit(&self) {
        self.send(json!(["quit"]));
        std::thread::sleep(Duration::from_millis(100));
        let _ = self.child.lock().unwrap().kill();
        let _ = std::fs::remove_file(&self.socket);
    }
}
