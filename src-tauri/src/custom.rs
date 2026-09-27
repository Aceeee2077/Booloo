// ============================================================================
// Lightweight custom image import. Selection goes to pending.<ext>; only a
// confirmed preview replaces custom.<ext>. Small images are returned as data URLs
// so rendering does not depend on asset-protocol permissions.
// ============================================================================

use crate::i18n::translate;
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const CUSTOM_EXTENSIONS: [&str; 5] = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MAX_CUSTOM_BYTES: u64 = 60 * 1024 * 1024;
const INLINE_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

fn inline_image(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > INLINE_IMAGE_BYTES { return None; }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp", "gif" => "image/gif", _ => return None,
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(fs::read(path).ok()?);
    Some(format!("data:{mime};base64,{encoded}"))
}

fn locale(app: &AppHandle) -> String {
    app.try_state::<crate::config::ConfigState>()
        .and_then(|state| state.get("locale").as_str().map(str::to_string))
        .unwrap_or_else(|| "zh".to_string())
}

fn custom_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("custom")
}

fn find_custom(dir: &Path) -> Option<PathBuf> {
    CUSTOM_EXTENSIONS
        .iter()
        .map(|ext| dir.join(format!("custom{ext}")))
        .find(|candidate| candidate.is_file())
}

fn find_pending(dir: &Path) -> Option<PathBuf> {
    CUSTOM_EXTENSIONS
        .iter()
        .map(|ext| dir.join(format!("pending{ext}")))
        .find(|candidate| candidate.is_file())
}

fn clear_pending(dir: &Path) {
    for ext in CUSTOM_EXTENSIONS {
        let _ = fs::remove_file(dir.join(format!("pending{ext}")));
    }
}

fn clear_existing(dir: &Path) {
    for ext in CUSTOM_EXTENSIONS {
        let _ = fs::remove_file(dir.join(format!("custom{ext}")));
    }
}

#[tauri::command]
pub fn custom_get(app: AppHandle) -> Value {
    let dir = custom_dir(&app);
    match find_custom(&dir) {
        Some(path) => {
            json!({
                "ok": true,
                "path": path.to_string_lossy(),
                "url": inline_image(&path),
                "mode": "single",
            })
        }
        None => json!({ "ok": false }),
    }
}

/// Pick into a temporary file. The active appearance is not touched until the
/// settings preview has been decoded and the user presses Use.
#[tauri::command]
pub async fn custom_pick_preview(app: AppHandle) -> Value {
    let dir = custom_dir(&app);
    clear_pending(&dir);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else { return json!({ "ok": false }); };
    let Ok(source) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&locale(&app), "dialog.readFailed") });
    };
    let extension = source.extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if !CUSTOM_EXTENSIONS.contains(&extension.as_str()) {
        return json!({ "ok": false, "error": translate(&locale(&app), "dialog.unsupportedFormat") });
    }
    let Ok(metadata) = fs::metadata(&source) else {
        return json!({ "ok": false, "error": translate(&locale(&app), "dialog.readFailed") });
    };
    if metadata.len() == 0 || metadata.len() > MAX_CUSTOM_BYTES {
        return json!({ "ok": false, "error": translate(&locale(&app), "dialog.fileTooLarge") });
    }
    if fs::create_dir_all(&dir).is_err() {
        return json!({ "ok": false, "error": translate(&locale(&app), "dialog.copyFailed") });
    }
    clear_pending(&dir);
    let pending = dir.join(format!("pending{extension}"));
    match fs::copy(&source, &pending) {
        Ok(_) => json!({ "ok": true, "path": pending.to_string_lossy(), "url": inline_image(&pending), "mode": "single" }),
        Err(_) => json!({ "ok": false, "error": translate(&locale(&app), "dialog.copyFailed") }),
    }
}

#[tauri::command]
pub fn custom_discard(app: AppHandle) {
    clear_pending(&custom_dir(&app));
}

#[tauri::command]
pub fn custom_commit(app: AppHandle, remove_background: bool) -> Value {
    let dir = custom_dir(&app);
    let Some(pending) = find_pending(&dir) else { return json!({ "ok": false, "error": "No preview image" }); };
    let Some(extension) = pending.extension().and_then(|value| value.to_str()) else {
        return json!({ "ok": false, "error": "Invalid image extension" });
    };
    let target = dir.join(format!("custom.{extension}"));
    let previous = find_custom(&dir);
    let backup = previous.as_ref().map(|old| dir.join(format!("previous.{}", old.extension().and_then(|value| value.to_str()).unwrap_or("png"))));
    if let (Some(old), Some(saved)) = (&previous, &backup) {
        let _ = fs::remove_file(saved);
        if fs::rename(old, saved).is_err() { return json!({ "ok": false, "error": "Could not preserve current image" }); }
    }
    if fs::rename(&pending, &target).is_err() {
        if let (Some(old), Some(saved)) = (&previous, &backup) { let _ = fs::rename(saved, old); }
        return json!({ "ok": false, "error": "Could not save image" });
    }
    for ext in CUSTOM_EXTENSIONS {
        let other = dir.join(format!("custom{ext}"));
        if other != target { let _ = fs::remove_file(other); }
    }
    if let Some(saved) = backup { let _ = fs::remove_file(saved); }
    if let Some(config) = app.try_state::<crate::config::ConfigState>() {
        let revision = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        let merged = config.apply(&json!({
            "skin": "custom", "currentPetId": "custom", "customImageMode": "single",
            "customImagePath": target.to_string_lossy(), "customImageRevision": revision,
            "autoCutout": remove_background
        }));
        config.persist();
        let _ = tauri::Emitter::emit(&app, "config-changed", merged);
    }
    json!({ "ok": true, "path": target.to_string_lossy(), "url": inline_image(&target), "mode": "single" })
}

#[tauri::command]
pub fn custom_clear(app: AppHandle) -> bool {
    let dir = custom_dir(&app);
    let existed = find_custom(&dir).is_some();
    clear_existing(&dir);
    if let Some(config) = app.try_state::<crate::config::ConfigState>() {
        let merged = config.apply(&json!({ "customImagePath": "" }));
        config.persist();
        let _ = tauri::Emitter::emit(&app, "config-changed", merged);
    }
    existed
}
