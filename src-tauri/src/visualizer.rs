// Visualiseur : capture du moniteur de la sortie par défaut (pw-record) + FFT → 64 bandes.
// Ne tourne que tant qu'un composant du frontend est abonné.

use std::io::{BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter};

const RATE: f32 = 48_000.0;
const FFT: usize = 2048;
const HOP: usize = 1024;
const BINS: usize = 64;

pub struct Visualizer {
    child: Mutex<Option<Child>>,
}

impl Visualizer {
    pub fn new() -> Visualizer {
        Visualizer { child: Mutex::new(None) }
    }

    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut guard = self.child.lock().unwrap();
        if let Some(c) = guard.as_mut() {
            if matches!(c.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        let mut child = Command::new("pw-record")
            .args(["--rate", "48000", "--channels", "1", "--format", "f32", "-P"])
            .arg("{ stream.capture.sink=true node.name=aura-visualiseur node.description=\"Aura (visualiseur)\" }")
            .arg("-")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("pw-record indisponible : {e}"))?;
        let stdout = child.stdout.take().ok_or("pas de sortie pw-record")?;
        *guard = Some(child);
        std::thread::Builder::new()
            .name("visualizer".into())
            .spawn(move || run(stdout, app))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn run(stdout: impl Read, app: AppHandle) {
    let mut r = BufReader::new(stdout);

    // En-tête AU (« .snd » gros-boutiste ou « dns. » petit-boutiste).
    let mut head = [0u8; 8];
    if r.read_exact(&mut head).is_err() {
        return;
    }
    let little = &head[0..4] == b"dns.";
    let offset = if little { u32::from_le_bytes(head[4..8].try_into().unwrap()) } else { u32::from_be_bytes(head[4..8].try_into().unwrap()) };
    let mut skip = vec![0u8; offset.saturating_sub(8) as usize];
    if r.read_exact(&mut skip).is_err() {
        return;
    }

    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT);
    let window: Vec<f32> = (0..FFT).map(|n| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * n as f32 / (FFT - 1) as f32).cos()).collect();
    // Bornes logarithmiques 40 Hz → 16 kHz.
    let edges: Vec<usize> = (0..=BINS)
        .map(|b| {
            let f = 40.0 * (16_000.0f32 / 40.0).powf(b as f32 / BINS as f32);
            ((f / RATE) * FFT as f32).round() as usize
        })
        .collect();

    let mut ring = vec![0f32; FFT];
    let mut smooth = vec![0f32; BINS];
    let mut buf = vec![0u8; HOP * 4];
    let mut spectrum = vec![Complex::new(0f32, 0f32); FFT];

    loop {
        if r.read_exact(&mut buf).is_err() {
            break;
        }
        ring.drain(..HOP);
        ring.extend(buf.chunks_exact(4).map(|c| {
            let b: [u8; 4] = c.try_into().unwrap();
            if little { f32::from_le_bytes(b) } else { f32::from_be_bytes(b) }
        }));

        for (k, s) in spectrum.iter_mut().enumerate() {
            *s = Complex::new(ring[k] * window[k], 0.0);
        }
        fft.process(&mut spectrum);

        let mut out = Vec::with_capacity(BINS);
        for b in 0..BINS {
            let (lo, hi) = (edges[b], edges[b + 1].max(edges[b] + 1));
            let peak = spectrum[lo..hi.min(FFT / 2)].iter().map(|c| c.norm()).fold(0f32, f32::max);
            let db = 20.0 * (peak / (FFT as f32 / 4.0) + 1e-9).log10();
            let v = ((db + 65.0) / 60.0).clamp(0.0, 1.0);
            // Montée immédiate, retombée douce.
            smooth[b] = if v > smooth[b] { v } else { smooth[b] * 0.82 + v * 0.18 };
            out.push((smooth[b] * 1000.0).round() / 1000.0);
        }
        if app.emit("player:analyser", &out).is_err() {
            break;
        }
    }
}
