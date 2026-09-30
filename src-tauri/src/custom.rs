// ============================================================================
// Lightweight custom image import. Selection goes to pending.<ext>; only a
// confirmed preview replaces custom.<ext>. Small images are returned as data URLs
// so rendering does not depend on asset-protocol permissions.
//
// The mask editor runs on top of this: `custom_mask_preview` segments the
// pending photo in Rust and hands the renderer the picture plus the initial
// keep-mask, `custom_commit` writes back either the untouched pending file (the
// quick "just use it" path) or the PNG the editor composited from the user's
// brushed mask.
// ============================================================================

use crate::cutout;
use crate::i18n::translate;
use base64::Engine;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
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

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Encode straight RGBA bytes as a PNG.
///
/// `Fast` + `Adaptive` is deliberate: the mask and the composited result are
/// already flat, so spending a second on maximum compression buys nothing.
fn encode_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let encoder = PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Adaptive);
    let _ = encoder.write_image(rgba, width, height, image::ExtendedColorType::Rgba8);
    out
}

/// Accept either a bare base64 payload or a `data:image/png;base64,…` URL.
fn decode_image_payload(payload: &str) -> Result<Vec<u8>, String> {
    let raw = payload.rsplit_once("base64,").map(|(_, tail)| tail).unwrap_or(payload);
    base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|_| "Invalid image data".to_string())
}

/// Replace `custom.<ext>` with the file `write` produces, keeping the previous
/// appearance on disk until the new one exists.
fn install_custom(
    dir: &Path,
    target: &Path,
    write: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let previous = find_custom(dir);
    let backup = previous
        .as_ref()
        .map(|old| dir.join(format!("previous.{}", old.extension().and_then(|value| value.to_str()).unwrap_or("png"))));
    if let (Some(old), Some(saved)) = (&previous, &backup) {
        let _ = fs::remove_file(saved);
        if fs::rename(old, saved).is_err() {
            return Err("Could not preserve current image".to_string());
        }
    }
    if let Err(error) = write(target) {
        if let (Some(old), Some(saved)) = (&previous, &backup) {
            let _ = fs::remove_file(target);
            let _ = fs::rename(saved, old);
        }
        return Err(error);
    }
    for ext in CUSTOM_EXTENSIONS {
        let other = dir.join(format!("custom{ext}"));
        if other != target {
            let _ = fs::remove_file(other);
        }
    }
    if let Some(saved) = backup {
        let _ = fs::remove_file(saved);
    }
    Ok(())
}

/// The cutout strength remembered by the settings panel.
fn config_tolerance(app: &AppHandle) -> u8 {
    app.try_state::<crate::config::ConfigState>()
        .and_then(|state| state.get("cutoutTolerance").as_u64())
        .map(|value| value.clamp(4, 96) as u8)
        .unwrap_or(cutout::DEFAULT_TOLERANCE)
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

/// Segment the pending photo and hand the renderer everything the mask editor
/// needs: the picture itself plus the initial keep-mask, both at the editor's
/// working resolution.
///
/// The renderer never sees the file path here — the payload is a data URL, so the
/// canvas stays untainted and the brush work can be read back pixel by pixel.
#[tauri::command]
pub async fn custom_mask_preview(
    app: AppHandle,
    tolerance: Option<u8>,
    feather: Option<u8>,
) -> Value {
    let locale = locale(&app);
    let dir = custom_dir(&app);
    let Some(pending) = find_pending(&dir) else {
        return json!({ "ok": false, "error": translate(&locale, "lite.mask.noImage") });
    };
    let Ok(bytes) = fs::read(&pending) else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.readFailed") });
    };
    let tolerance = tolerance.map(|value| value.clamp(4, 96)).unwrap_or_else(|| config_tolerance(&app));
    let feather = feather.unwrap_or(cutout::DEFAULT_FEATHER).min(6);
    // Small files are handed over byte for byte (the webview decodes JPEG/WebP
    // natively and this is the cheapest payload); a huge one is re-encoded from
    // the working buffer inside `mask_preview_payload` so a 60 MB import never
    // travels through the IPC.
    let inline = if bytes.len() <= INLINE_IMAGE_BYTES as usize { inline_image(&pending) } else { None };
    match mask_preview_payload(&bytes, inline, tolerance, feather) {
        Ok(payload) => payload,
        Err(key) => json!({ "ok": false, "error": translate(&locale, key) }),
    }
}

/// Decode → segment → encode. Split out of the command so the payload contract
/// with the editor can be tested without an `AppHandle`.
fn mask_preview_payload(
    bytes: &[u8],
    inline_original: Option<String>,
    tolerance: u8,
    feather: u8,
) -> Result<Value, &'static str> {
    let decoded = image::load_from_memory(bytes).map_err(|_| "dialog.unsupportedFormat")?;

    // Segment at the working resolution: the mask is only ever used to composite
    // the pet, and decoding a 16 MP photo into a second full-size buffer just to
    // throw 80 % of it away costs a second and a lot of memory.
    let rgba = decoded.to_rgba8();
    let (full_w, full_h) = (rgba.width(), rgba.height());
    let scale = (cutout::WORK_MAX_EDGE as f32 / full_w.max(full_h) as f32).min(1.0);
    let (width, height) = (
        ((full_w as f32 * scale).round() as u32).max(1),
        ((full_h as f32 * scale).round() as u32).max(1),
    );
    let work = if width == full_w && height == full_h {
        rgba
    } else {
        image::imageops::resize(&rgba, width, height, image::imageops::FilterType::Lanczos3)
    };
    let cut = cutout::segment(work.as_raw(), width, height, tolerance, feather);
    // The mask travels as white RGBA with the keep factor in the alpha channel, so
    // the renderer can stamp it straight into its mask canvas.
    let mut mask = vec![255u8; cut.alpha.len() * 4];
    for (index, value) in cut.alpha.iter().enumerate() {
        mask[index * 4 + 3] = *value;
    }

    Ok(json!({
        "ok": true,
        "width": width,
        "height": height,
        "original": inline_original
            .unwrap_or_else(|| data_url("image/png", &encode_png(work.as_raw(), width, height))),
        "mask": data_url("image/png", &encode_png(&mask, width, height)),
        "subject": cut.subject_ratio,
        "applied": cut.applied,
        "rejected": cut.rejected,
        "tolerance": tolerance,
        "feather": feather,
    }))
}

#[tauri::command]
pub fn custom_commit(app: AppHandle, remove_background: Option<bool>, png: Option<String>) -> Value {
    let dir = custom_dir(&app);
    let remove_background = remove_background.unwrap_or(false);
    let pending = find_pending(&dir);
    let baked = png.is_some();

    // Two ways in: the editor hands over the PNG it composited from the brushed
    // mask, or the settings preview confirms the pending file untouched.
    let target = if let Some(payload) = png {
        let Ok(composed) = decode_image_payload(&payload) else {
            return json!({ "ok": false, "error": "Invalid image data" });
        };
        if image::guess_format(&composed).ok() != Some(image::ImageFormat::Png) {
            return json!({ "ok": false, "error": "Invalid image data" });
        }
        let target = dir.join("custom.png");
        if fs::create_dir_all(&dir).is_err() {
            return json!({ "ok": false, "error": translate(&locale(&app), "dialog.copyFailed") });
        }
        if let Err(error) = install_custom(&dir, &target, |path| {
            fs::write(path, &composed).map_err(|_| "Could not save image".to_string())
        }) {
            return json!({ "ok": false, "error": error });
        }
        target
    } else {
        let Some(pending) = pending else { return json!({ "ok": false, "error": "No preview image" }); };
        let Some(extension) = pending.extension().and_then(|value| value.to_str()) else {
            return json!({ "ok": false, "error": "Invalid image extension" });
        };
        let target = dir.join(format!("custom.{extension}"));
        if let Err(error) = install_custom(&dir, &target, |path| {
            fs::rename(&pending, path).map_err(|_| "Could not save image".to_string())
        }) {
            return json!({ "ok": false, "error": error });
        }
        target
    };
    // A composited PNG already carries its transparency, so it must never be keyed
    // a second time when the pet window loads it.
    let auto_cutout = remove_background && !baked;
    if let Some(config) = app.try_state::<crate::config::ConfigState>() {
        let revision = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        let merged = config.apply(&json!({
            "skin": "custom", "currentPetId": "custom", "customImageMode": "single",
            "customImagePath": target.to_string_lossy(), "customImageRevision": revision,
            "autoCutout": auto_cutout
        }));
        config.persist();
        let _ = tauri::Emitter::emit(&app, "config-changed", merged);
        let _ = tauri::Emitter::emit(&app, "custom-image-changed", ());
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("booloo-custom-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn encodes_a_mask_png_the_webview_can_decode() {
        let pixels = [255u8, 255, 255, 0, 255, 255, 255, 128];
        let png = encode_png(&pixels, 2, 1);
        let decoded = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!((decoded.width(), decoded.height()), (2, 1));
        assert_eq!(decoded.into_raw(), pixels);
    }

    #[test]
    fn accepts_both_payload_shapes_from_the_editor() {
        let png = encode_png(&[10, 20, 30, 255], 1, 1);
        let bare = base64::engine::general_purpose::STANDARD.encode(&png);
        assert_eq!(decode_image_payload(&bare).unwrap(), png);
        assert_eq!(decode_image_payload(&format!("data:image/png;base64,{bare}")).unwrap(), png);
        assert!(decode_image_payload("not base64 !!!").is_err());
    }

    /// The payload shape the editor binds to: a data URL per image, the working
    /// size, and a mask whose alpha channel is the keep factor.
    #[test]
    fn mask_preview_payload_matches_the_editor_contract() {
        let mut rgba = vec![255u8; 64 * 64 * 4];
        for y in 16..48 {
            for x in 16..48 {
                let offset = (y * 64 + x) * 4;
                rgba[offset..offset + 4].copy_from_slice(&[220, 90, 110, 255]);
            }
        }
        let payload = mask_preview_payload(&encode_png(&rgba, 64, 64), None, 25, 1).unwrap();
        assert_eq!(payload["ok"], true);
        assert_eq!(payload["width"], 64);
        assert_eq!(payload["height"], 64);

        let mask = image::load_from_memory(&decode_image_payload(payload["mask"].as_str().unwrap()).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!((mask.width(), mask.height()), (64, 64));
        assert_eq!(mask.get_pixel(32, 32).0, [255, 255, 255, 255], "the subject is kept");
        assert_eq!(mask.get_pixel(0, 0).0[3], 0, "the background is removed");
        assert!(payload["subject"].as_f64().unwrap() > 0.1);
        assert_eq!(payload["applied"], true);

        // A picture that is already cut out keeps its alpha and gets a full mask.
        let transparent = mask_preview_payload(&encode_png(&vec![0u8; 8 * 8 * 4], 8, 8), None, 25, 1).unwrap();
        assert_eq!(transparent["applied"], false);
        assert_eq!(transparent["rejected"], false);

        // Garbage from a corrupted file is reported, never panicked on.
        assert!(mask_preview_payload(b"not an image", None, 25, 1).is_err());
    }

    /// The editor only ever works on a bounded copy of the picture.
    #[test]
    fn mask_preview_scales_large_imports_down_to_the_working_edge() {
        let rgba = vec![255u8; 1700 * 40 * 4];
        let payload = mask_preview_payload(&encode_png(&rgba, 1700, 40), None, 25, 1).unwrap();
        assert_eq!(payload["width"], 1600);
        assert_eq!(payload["height"], 38);
    }

    #[test]
    fn replacing_the_appearance_keeps_the_previous_file_until_the_new_one_lands() {
        let dir = scratch_dir("install");
        fs::write(dir.join("custom.jpg"), b"old").unwrap();

        // A failed write has to leave the current appearance exactly as it was.
        let failed = install_custom(&dir, &dir.join("custom.png"), |_| Err("boom".to_string()));
        assert_eq!(failed, Err("boom".to_string()));
        assert_eq!(fs::read(dir.join("custom.jpg")).unwrap(), b"old");
        assert!(find_custom(&dir).is_some());

        // A successful write drops the stale extension so only one custom.* is left.
        let target = dir.join("custom.png");
        install_custom(&dir, &target, |path| fs::write(path, b"new").map_err(|_| "io".to_string())).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!dir.join("custom.jpg").exists());
        assert_eq!(find_custom(&dir), Some(target.clone()));

        let _ = fs::remove_dir_all(&dir);
    }
}
