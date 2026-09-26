// Paramètres persistés dans ~/.config/<identifiant>/settings.json.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;

use crate::models::Settings;

pub struct SettingsStore {
    path: PathBuf,
    value: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> SettingsStore {
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| {
                // Fusion avec les valeurs par défaut pour tolérer les champs ajoutés plus tard.
                let mut base = serde_json::to_value(Settings::default()).ok()?;
                let saved: Value = serde_json::from_str(&s).ok()?;
                merge(&mut base, saved);
                serde_json::from_value(base).ok()
            })
            .unwrap_or_default();
        SettingsStore { path, value: Mutex::new(value) }
    }

    pub fn get(&self) -> Settings {
        self.value.lock().unwrap().clone()
    }

    /// Applique un patch JSON partiel (même forme que `Partial<Settings>` côté TS).
    pub fn update(&self, patch: Value) -> Settings {
        let mut cur = self.value.lock().unwrap();
        let mut v = serde_json::to_value(&*cur).unwrap_or(Value::Null);
        merge(&mut v, patch);
        if let Ok(next) = serde_json::from_value::<Settings>(v) {
            *cur = next;
        }
        self.save(&cur);
        cur.clone()
    }

    pub fn modify(&self, f: impl FnOnce(&mut Settings)) -> Settings {
        let mut cur = self.value.lock().unwrap();
        f(&mut cur);
        self.save(&cur);
        cur.clone()
    }

    fn save(&self, s: &Settings) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(s) {
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(tmp, &self.path);
            }
        }
    }
}

fn merge(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                match b.get_mut(&k) {
                    Some(slot) if slot.is_object() && v.is_object() => merge(slot, v),
                    _ => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (b, p) => *b = p,
    }
}
