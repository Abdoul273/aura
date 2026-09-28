// Sauvegarde cohérente de SQLite, des réglages et des pochettes choisies à la main.
// Une restauration est préparée dans la configuration puis appliquée avant l'ouverture de SQLite.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::db::{now_ms, Db};

fn copy_covers(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    if !from.is_dir() { return Ok(()); }
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "jpg") {
            std::fs::copy(&path, to.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn validate(folder: &Path) -> Result<(), String> {
    let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(folder.join("manifest.json")).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Manifeste invalide : {e}"))?;
    if manifest["format"] != 1 { return Err("Format de sauvegarde non pris en charge".into()); }
    let settings: serde_json::Value = serde_json::from_slice(&std::fs::read(folder.join("settings.json")).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Réglages invalides : {e}"))?;
    if !settings.is_object() { return Err("Réglages invalides".into()); }
    let conn = Connection::open_with_flags(folder.join("aura.db"), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let status: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if status != "ok" { return Err(format!("Base de données invalide : {status}")); }
    let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('tracks', 'albums', 'playlists', 'kv')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if tables != 4 { return Err("Ce dossier ne contient pas une bibliothèque Aura".into()); }
    Ok(())
}

pub fn create(db: &Db, settings: &str, covers: &Path, parent: &Path) -> Result<PathBuf, String> {
    if !parent.is_dir() { return Err("Dossier de destination introuvable".into()); }
    let folder = parent.join(format!("Aura-sauvegarde-{}", now_ms()));
    std::fs::create_dir(&folder).map_err(|e| e.to_string())?;
    let result = (|| {
        db.backup_to(&folder.join("aura.db")).map_err(|e| e.to_string())?;
        std::fs::write(folder.join("settings.json"), settings).map_err(|e| e.to_string())?;
        copy_covers(covers, &folder.join("covers"))?;
        std::fs::write(folder.join("manifest.json"), format!("{{\"format\":1,\"createdAt\":{}}}", now_ms())).map_err(|e| e.to_string())?;
        validate(&folder)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(e);
    }
    Ok(folder)
}

pub fn prepare_restore(source: &Path, config_dir: &Path) -> Result<(), String> {
    validate(source)?;
    let pending = config_dir.join("restore-pending");
    if pending.exists() { std::fs::remove_dir_all(&pending).map_err(|e| e.to_string())?; }
    std::fs::create_dir_all(&pending).map_err(|e| e.to_string())?;
    let result = (|| {
        for file in ["aura.db", "settings.json", "manifest.json"] {
            std::fs::copy(source.join(file), pending.join(file)).map_err(|e| e.to_string())?;
        }
        copy_covers(&source.join("covers"), &pending.join("covers"))?;
        validate(&pending)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&pending);
        return Err(e);
    }
    Ok(())
}

pub fn apply_pending(data_dir: &Path, config_dir: &Path, cache_dir: &Path) -> Result<(), String> {
    let pending = config_dir.join("restore-pending");
    if !pending.exists() { return Ok(()); }
    validate(&pending)?;

    let db = data_dir.join("aura.db");
    let settings = config_dir.join("settings.json");
    let covers = cache_dir.join("covers");
    let had_db = db.exists();
    let had_settings = settings.exists();
    let had_covers = covers.exists();
    let new_db = data_dir.join("aura.db.restore-ready");
    let new_settings = config_dir.join("settings.json.restore-ready");
    let new_covers = cache_dir.join("covers.restore-ready");
    if new_db.exists() { std::fs::remove_file(&new_db).map_err(|e| e.to_string())?; }
    if new_settings.exists() { std::fs::remove_file(&new_settings).map_err(|e| e.to_string())?; }
    if new_covers.exists() { std::fs::remove_dir_all(&new_covers).map_err(|e| e.to_string())?; }
    std::fs::copy(pending.join("aura.db"), &new_db).map_err(|e| e.to_string())?;
    std::fs::copy(pending.join("settings.json"), &new_settings).map_err(|e| e.to_string())?;
    copy_covers(&pending.join("covers"), &new_covers)?;

    if db.exists() {
        let conn = Connection::open(&db).map_err(|e| e.to_string())?;
        let busy: i64 = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if busy != 0 { return Err("Bibliothèque utilisée par une autre fenêtre Aura".into()); }
    }
    let old_db = data_dir.join("aura.db.before-restore");
    let old_settings = config_dir.join("settings.json.before-restore");
    let old_covers = cache_dir.join("covers.before-restore");
    if old_db.exists() { std::fs::remove_file(&old_db).map_err(|e| e.to_string())?; }
    if old_settings.exists() { std::fs::remove_file(&old_settings).map_err(|e| e.to_string())?; }
    if old_covers.exists() { std::fs::remove_dir_all(&old_covers).map_err(|e| e.to_string())?; }

    let swap = (|| -> Result<(), String> {
        if db.exists() { std::fs::rename(&db, &old_db).map_err(|e| e.to_string())?; }
        std::fs::rename(&new_db, &db).map_err(|e| e.to_string())?;
        if settings.exists() { std::fs::rename(&settings, &old_settings).map_err(|e| e.to_string())?; }
        std::fs::rename(&new_settings, &settings).map_err(|e| e.to_string())?;
        if covers.exists() { std::fs::rename(&covers, &old_covers).map_err(|e| e.to_string())?; }
        std::fs::rename(&new_covers, &covers).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = swap {
        if old_covers.exists() { let _ = std::fs::remove_dir_all(&covers); let _ = std::fs::rename(&old_covers, &covers); }
        else if !had_covers { let _ = std::fs::remove_dir_all(&covers); }
        if old_settings.exists() { let _ = std::fs::remove_file(&settings); let _ = std::fs::rename(&old_settings, &settings); }
        else if !had_settings { let _ = std::fs::remove_file(&settings); }
        if old_db.exists() { let _ = std::fs::remove_file(&db); let _ = std::fs::rename(&old_db, &db); }
        else if !had_db { let _ = std::fs::remove_file(&db); }
        return Err(error);
    }
    for suffix in ["-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{}", db.display(), suffix)); }
    let _ = std::fs::remove_dir_all(pending);
    Ok(())
}
