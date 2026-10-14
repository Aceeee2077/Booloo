// ============================================================================
// Pet packs — a user-imported character, installed as one folder.
//
// A pack is a self-contained folder: `petpack.json` (the PetDefinition in
// src/shared/petpack-types.ts) plus the sprite sheet it points at. Importing
// copies that folder into the app's own data directory, so the pet keeps working
// after the original is moved, renamed or sits on a drive that was unplugged;
// exporting copies it back out so a pack can be shared.
//
// Layout: %APPCONFIG%/pets/<id>/petpack.json + <sheet>. The id doubles as the
// folder name, so it is slugified on the way in and refused when it could climb
// out of the directory.
//
// The pet window draws the sheet itself (src/renderer/lite-pack.ts); nothing here
// knows about a frame beyond checking that the manifest describes one that exists.
// ============================================================================

use crate::config::ConfigState;
use crate::custom::inline_image;
use crate::i18n::translate;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// One pack may not take more room than this: the whole app is a few megabytes,
/// and a "pet" is not a reason to let a folder fill the app-data directory.
const MAX_PACK_BYTES: u64 = 120 * 1024 * 1024;
/// The sheet is decoded by the webview, so its declared size is bounded too.
const MAX_SHEET_PIXELS: u64 = 8192 * 8192;
/// Sheet formats the webview can draw and `inline_image` can label.
const SHEET_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

const MANIFEST: &str = "petpack.json";

/// A refused manifest: the dictionary key plus the values its sentence needs.
///
/// Validation returns this instead of a translated string so the rules stay
/// testable without an `AppHandle` (`cargo test` never builds a window).
#[derive(Debug)]
struct PackError {
    key: &'static str,
    params: Value,
}

impl PackError {
    fn new(key: &'static str, params: Value) -> Self {
        Self { key, params }
    }
}

/// Where installed packs live.
pub fn pets_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("pets")
}

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<ConfigState>()
        .and_then(|state| state.get("locale").as_str().map(str::to_string))
        .unwrap_or_else(|| "zh".to_string())
}

/// Fold a manifest id into something usable as one folder name.
///
/// An id from a downloaded pack is untrusted input, and it ends up in a path:
/// anything outside `[a-z0-9_-]` becomes `-`, so `../../evil` cannot climb out of
/// the pets directory.
fn slug(value: &str) -> String {
    let lowered = value.trim().to_ascii_lowercase();
    let mut slug = String::new();
    let mut last_dash = false;
    for character in lowered.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            slug.push(character);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.truncate(64);
    slug.trim_end_matches('-').to_string()
}

/// Whether a manifest path stays inside the pack folder.
///
/// Only plain file names are allowed: no absolute paths, no `..`, no drive or root
/// components, and the extension has to be one the webview can draw.
fn safe_sheet(value: &str) -> bool {
    let path = Path::new(value.trim());
    if value.trim().is_empty() || path.is_absolute() {
        return false;
    }
    if !path.components().all(|part| matches!(part, Component::Normal(_))) {
        return false;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| SHEET_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// One required, positive, whole number out of the `sprite` block.
fn positive(sprite: &Value, field: &str) -> Result<u32, PackError> {
    sprite
        .get(field)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= 65_536)
        .map(|value| value as u32)
        .ok_or_else(|| PackError::new("lite.pack.badSprite", json!({ "detail": field })))
}

/// A trimmed, non-empty string field, as an optional JSON member.
fn optional_text(raw: &Value, key: &str) -> Option<Value> {
    raw.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| json!(text))
}

/// Validate a manifest and hand back the normalized definition the app stores.
///
/// Everything the pet window reads is guaranteed afterwards: a usable `id`, a
/// sheet name that stays inside the folder, a positive frame grid, and at least
/// one animation whose frame numbers actually exist on that sheet. Defaults fill
/// the two fields an author is most likely to leave out (`fps`, `loop`) rather
/// than refusing the pack over them.
fn validate(raw: &Value, id_hint: &str) -> Result<Value, PackError> {
    let schema = raw.get("schemaVersion").and_then(Value::as_u64).unwrap_or(1);
    if schema != 1 {
        return Err(PackError::new("lite.pack.badSchema", json!({ "v": schema })));
    }

    let id = slug(raw.get("id").and_then(Value::as_str).unwrap_or(id_hint));
    if id.is_empty() {
        return Err(PackError::new("lite.pack.badId", json!({})));
    }

    let sheet = raw
        .pointer("/assets/spritesheet")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if !safe_sheet(&sheet) {
        return Err(PackError::new("lite.pack.missingSheet", json!({ "file": sheet })));
    }

    let sprite = raw
        .get("sprite")
        .filter(|value| value.is_object())
        .ok_or_else(|| PackError::new("lite.pack.badSprite", json!({ "detail": "sprite" })))?;
    let frame_width = positive(sprite, "frameWidth")?;
    let frame_height = positive(sprite, "frameHeight")?;
    let columns = positive(sprite, "columns")?;
    let rows = positive(sprite, "rows")?;
    let scale = sprite
        .get("scale")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(1.0);

    let cells = u64::from(columns) * u64::from(rows);
    if u64::from(frame_width) * u64::from(frame_height) * cells > MAX_SHEET_PIXELS {
        return Err(PackError::new("lite.pack.badSprite", json!({ "detail": "size" })));
    }

    let declared = raw
        .get("animations")
        .and_then(Value::as_object)
        .filter(|map| !map.is_empty())
        .ok_or_else(|| PackError::new("lite.pack.badAnimation", json!({ "detail": "animations" })))?;
    let mut animations = Map::new();
    for (name, animation) in declared {
        if name.trim().is_empty() {
            continue;
        }
        let frames = animation
            .get("frames")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .ok_or_else(|| PackError::new("lite.pack.badAnimation", json!({ "detail": name })))?;
        let mut slots = Vec::with_capacity(frames.len());
        for frame in frames {
            let slot = frame
                .as_u64()
                .filter(|slot| *slot < cells)
                .ok_or_else(|| PackError::new("lite.pack.badAnimation", json!({ "detail": name })))?;
            slots.push(json!(slot));
        }
        let fps = animation
            .get("fps")
            .and_then(Value::as_f64)
            .filter(|fps| fps.is_finite() && *fps > 0.0)
            .unwrap_or(8.0);
        let looping = animation.get("loop").and_then(Value::as_bool).unwrap_or(true);
        animations.insert(name.clone(), json!({ "frames": slots, "fps": fps, "loop": looping }));
    }
    if animations.is_empty() {
        return Err(PackError::new("lite.pack.badAnimation", json!({ "detail": "animations" })));
    }

    let mut normalized = Map::new();
    normalized.insert("schemaVersion".into(), json!(1));
    normalized.insert("id".into(), json!(id));
    normalized.insert(
        "displayName".into(),
        optional_text(raw, "displayName").unwrap_or_else(|| json!(id)),
    );
    for key in ["description", "author", "version"] {
        if let Some(text) = optional_text(raw, key) {
            normalized.insert(key.into(), text);
        }
    }
    normalized.insert("assets".into(), json!({ "spritesheet": sheet }));
    normalized.insert(
        "sprite".into(),
        json!({
            "frameWidth": frame_width, "frameHeight": frame_height,
            "columns": columns, "rows": rows, "scale": scale,
        }),
    );
    normalized.insert("animations".into(), Value::Object(animations));
    normalized.insert("source".into(), json!("imported"));
    Ok(Value::Object(normalized))
}

/// Translate a refusal for the user, filling the sentence's placeholders.
fn error_text(app: &AppHandle, error: PackError) -> String {
    let locale = current_locale(app);
    let mut text = translate(&locale, error.key);
    if let Some(params) = error.params.as_object() {
        for (name, value) in params {
            let replacement = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            text = text.replace(&format!("{{{name}}}"), &replacement);
        }
    }
    text
}

/// Check the sheet is on disk and is exactly the grid the manifest describes.
///
/// A mismatch here is the mistake every hand-authored pack makes at least once,
/// and it would otherwise show up as a pet drawn from the wrong frames.
fn check_sheet(dir: &Path, manifest: &Value) -> Result<(), PackError> {
    let sheet = manifest
        .pointer("/assets/spritesheet")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = dir.join(sheet);
    let Some((width, height)) = image::image_dimensions(&path).ok() else {
        return Err(PackError::new("lite.pack.missingSheet", json!({ "file": sheet })));
    };
    let sprite = manifest.get("sprite").cloned().unwrap_or_else(|| json!({}));
    let expected_width = sprite.get("frameWidth").and_then(Value::as_u64).unwrap_or(0)
        * sprite.get("columns").and_then(Value::as_u64).unwrap_or(0);
    let expected_height = sprite.get("frameHeight").and_then(Value::as_u64).unwrap_or(0)
        * sprite.get("rows").and_then(Value::as_u64).unwrap_or(0);
    if u64::from(width) != expected_width || u64::from(height) != expected_height {
        return Err(PackError::new(
            "lite.pack.badSheet",
            json!({
                "width": width, "height": height,
                "expected": format!("{expected_width}×{expected_height}"),
            }),
        ));
    }
    Ok(())
}

/// Total size of a folder, stopped as soon as it is over the limit.
///
/// Symlinks are not followed, for the same reason `copy_tree` skips them: a pack
/// has no business reaching outside its own folder, and a link loop would hang the
/// walk instead of failing it.
fn folder_bytes(dir: &Path) -> u64 {
    let mut total = 0_u64;
    let Ok(entries) = fs::read_dir(dir) else {
        return u64::MAX;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            total = total.saturating_add(folder_bytes(&entry.path()));
        } else if kind.is_file() {
            total = total.saturating_add(entry.metadata().map(|meta| meta.len()).unwrap_or(0));
        }
        if total > MAX_PACK_BYTES {
            return total;
        }
    }
    total
}

/// Copy a pack folder, skipping anything that is not a plain file or directory.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// One installed pack as the renderer wants it: metadata, where it lives, and a
/// URL it can draw. An unusable folder is skipped rather than reported — one
/// broken pack must not stop the others from loading.
fn read_pack(dir: &Path) -> Option<Value> {
    let hint = dir.file_name().and_then(|name| name.to_str()).unwrap_or("pack");
    // A pack that fails to load is skipped rather than reported to the user, but
    // silently dropping it leaves no way to explain why it vanished — so the log
    // gets the reason. `PackError` is rendered from its key and params here
    // because this path has no `AppHandle` to translate with.
    let raw: Value = match fs::read_to_string(dir.join(MANIFEST)) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(parsed) => parsed,
            Err(error) => {
                crate::logfile::warn(format!(
                    "skipping pet pack '{hint}': the manifest is not valid JSON ({error})"
                ));
                return None;
            }
        },
        Err(error) => {
            crate::logfile::warn(format!(
                "skipping pet pack '{hint}': the manifest could not be read ({error})"
            ));
            return None;
        }
    };
    let manifest = match validate(&raw, hint) {
        Ok(manifest) => manifest,
        Err(error) => {
            crate::logfile::warn(format!(
                "skipping pet pack '{hint}': {} {}",
                error.key, error.params
            ));
            return None;
        }
    };
    if let Err(error) = check_sheet(dir, &manifest) {
        crate::logfile::warn(format!(
            "skipping pet pack '{hint}': {} {}",
            error.key, error.params
        ));
        return None;
    }
    let sheet = manifest
        .pointer("/assets/spritesheet")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let sheet_path = dir.join(&sheet);
    Some(json!({
        "id": manifest.get("id").cloned().unwrap_or(Value::Null),
        "displayName": manifest.get("displayName").cloned().unwrap_or(Value::Null),
        "description": manifest.get("description").cloned().unwrap_or(Value::Null),
        "author": manifest.get("author").cloned().unwrap_or(Value::Null),
        "version": manifest.get("version").cloned().unwrap_or(Value::Null),
        "dir": dir.to_string_lossy(),
        "spritesheet": sheet_path.to_string_lossy(),
        "url": inline_image(&sheet_path),
        "manifest": manifest,
    }))
}

/// Install a picked folder as a pack.
fn install(app: &AppHandle, source: &Path) -> Value {
    if !source.join(MANIFEST).is_file() {
        return json!({ "ok": false, "error": translate(&current_locale(app), "lite.pack.noManifest") });
    }
    let Some(raw) = fs::read_to_string(source.join(MANIFEST))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    else {
        return json!({ "ok": false, "error": translate(&current_locale(app), "dialog.readFailed") });
    };
    let hint = source.file_name().and_then(|name| name.to_str()).unwrap_or("pack");
    let manifest = match validate(&raw, hint) {
        Ok(manifest) => manifest,
        Err(error) => return json!({ "ok": false, "error": error_text(app, error) }),
    };
    if folder_bytes(source) > MAX_PACK_BYTES {
        return json!({ "ok": false, "error": translate(&current_locale(app), "lite.pack.tooLarge") });
    }
    if let Err(error) = check_sheet(source, &manifest) {
        return json!({ "ok": false, "error": error_text(app, error) });
    }

    let id = manifest.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let root = pets_dir(app);
    if fs::create_dir_all(&root).is_err() {
        return json!({ "ok": false, "error": translate(&current_locale(app), "dialog.copyFailed") });
    }
    let target = root.join(&id);
    // Re-importing the same id replaces the installed copy, so an edited pack does
    // not end up as two half-merged folders.
    let _ = fs::remove_dir_all(&target);
    let normalized = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    // The normalized manifest is what gets stored: the folder then re-validates to
    // exactly what this function returned, with the defaults filled in.
    let copied = copy_tree(source, &target).and_then(|_| fs::write(target.join(MANIFEST), normalized));
    if copied.is_err() {
        let _ = fs::remove_dir_all(&target);
        return json!({ "ok": false, "error": translate(&current_locale(app), "dialog.copyFailed") });
    }
    let locale = current_locale(app);
    match read_pack(&target) {
        Some(pet) => json!({ "ok": true, "pet": pet }),
        None => {
            let _ = fs::remove_dir_all(&target);
            json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") })
        }
    }
}

/// Every installed pack, sorted by display name.
#[tauri::command]
pub fn pet_list(app: AppHandle) -> Value {
    let dir = pets_dir(&app);
    let mut pets = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            if let Some(pet) = read_pack(&entry.path()) {
                pets.push(pet);
            }
        }
    }
    pets.sort_by(|a, b| {
        let left = a.get("displayName").and_then(Value::as_str).unwrap_or("");
        let right = b.get("displayName").and_then(Value::as_str).unwrap_or("");
        left.to_lowercase().cmp(&right.to_lowercase())
    });
    json!({ "ok": true, "pets": pets })
}

/// Pick a folder and install it. Nothing is written until the folder has been
/// validated, so a wrong pick costs one dialog and no cleanup.
#[tauri::command]
pub async fn pet_import(app: AppHandle) -> Value {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let Ok(source) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "dialog.readFailed") });
    };
    install(&app, &source)
}

/// Copy an installed pack out to a folder the user picks, ready to share.
#[tauri::command]
pub async fn pet_export(app: AppHandle, id: String) -> Value {
    let id = slug(&id);
    let source = pets_dir(&app).join(&id);
    if id.is_empty() || !source.is_dir() {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.notFound") });
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let Ok(destination) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "dialog.readFailed") });
    };
    let target = destination.join(&id);
    match copy_tree(&source, &target) {
        Ok(()) => json!({ "ok": true, "path": target.to_string_lossy() }),
        Err(_) => json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.exportFailed") }),
    }
}

/// Delete an installed pack, and put the pet back on Bulu when it was wearing it.
#[tauri::command]
pub fn pet_remove(app: AppHandle, id: String) -> Value {
    let id = slug(&id);
    let target = pets_dir(&app).join(&id);
    if id.is_empty() || !target.is_dir() {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.notFound") });
    }
    if fs::remove_dir_all(&target).is_err() {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.removeFailed") });
    }
    // A config still pointing at the deleted pack would ask the pet window for art
    // that no longer exists, so it falls back to the built-in character here rather
    // than depending on the settings panel to notice.
    if let Some(state) = app.try_state::<ConfigState>() {
        let wearing = state.get("skin").as_str() == Some("pack")
            && state.get("currentPetId").as_str() == Some(id.as_str());
        if wearing {
            let merged = state.apply(&json!({ "skin": "bulu", "currentPetId": "bulu" }));
            state.persist();
            let _ = app.emit("config-changed", merged);
        }
    }
    json!({ "ok": true })
}

/// Where an in-progress edit keeps its sheet: a sibling of `pets/`, so a draft is
/// never mistaken for an installed pack by `pet_list`.
fn pack_draft_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("pack-draft")
}

/// Forget whatever the last edit left behind. A draft that cannot be cleared is
/// overwritten by the next pick anyway, so the failure is not worth reporting.
fn clear_draft(app: &AppHandle) {
    let _ = fs::remove_dir_all(pack_draft_dir(app));
}

/// The one name a sheet takes inside the draft folder. Only extensions the
/// webview can draw survive, so a picked file that is not an image is refused
/// before it is copied anywhere.
fn draft_sheet_name(extension: &str) -> Option<String> {
    let extension = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    SHEET_EXTENSIONS
        .contains(&extension.as_str())
        .then(|| format!("sheet.{extension}"))
}

/// Move a validated manifest and its sheet into `pets/<id>`, replacing whatever
/// was there. The new copy is assembled under a staging name and renamed into
/// place only once it is whole, so a failure part-way cannot leave a half-written
/// pack for the pet window to find.
fn write_pack(draft: &Path, pets_root: &Path, manifest: &Value) -> std::io::Result<PathBuf> {
    let id = manifest.get("id").and_then(Value::as_str).unwrap_or_default();
    let sheet = manifest
        .pointer("/assets/spritesheet")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let staging = pets_root.join(format!("{id}.staging"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)?;
    fs::copy(draft.join(sheet), staging.join(sheet))?;
    fs::write(
        staging.join(MANIFEST),
        serde_json::to_string_pretty(manifest).unwrap_or_default(),
    )?;
    let target = pets_root.join(id);
    let _ = fs::remove_dir_all(&target);
    fs::rename(&staging, &target)?;
    Ok(target)
}

/// Start a new pack, or reopen an installed one for editing.
///
/// A blank `id` clears the draft and reports "new": the editor then waits for a
/// sheet to be picked. Otherwise the installed sheet is copied into the draft and
/// the manifest comes back with its sheet name pointing at that copy, so every
/// save reads from one place no matter where the pack was first imported from.
#[tauri::command]
pub fn pet_editor_open(app: AppHandle, id: String) -> Value {
    let locale = current_locale(&app);
    clear_draft(&app);
    let id = slug(&id);
    if id.is_empty() {
        return json!({ "ok": true, "manifest": Value::Null });
    }
    let source = pets_dir(&app).join(&id);
    let Some(pet) = (source.is_dir()).then(|| read_pack(&source)).flatten() else {
        return json!({ "ok": false, "error": translate(&locale, "lite.pack.notFound") });
    };
    let sheet_path = pet
        .pointer("/manifest/assets/spritesheet")
        .and_then(Value::as_str)
        .map(|sheet| source.join(sheet))
        .unwrap_or_default();
    let Some(sheet) = sheet_path
        .extension()
        .and_then(|value| value.to_str())
        .and_then(draft_sheet_name)
    else {
        return json!({ "ok": false, "error": translate(&locale, "lite.pack.notFound") });
    };
    let dir = pack_draft_dir(&app);
    if fs::create_dir_all(&dir).is_err() || fs::copy(&sheet_path, dir.join(&sheet)).is_err() {
        return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
    }
    let mut manifest = pet.get("manifest").cloned().unwrap_or_else(|| json!({}));
    if let Some(assets) = manifest.get_mut("assets").and_then(Value::as_object_mut) {
        assets.insert("spritesheet".into(), json!(sheet));
    }
    let path = dir.join(&sheet);
    let size = image::image_dimensions(&path).ok();
    json!({
        "ok": true,
        "manifest": manifest,
        "sheet": sheet,
        "path": path.to_string_lossy(),
        "url": inline_image(&path),
        "width": size.map(|value| value.0),
        "height": size.map(|value| value.1),
    })
}

/// Pick a sheet image for the pack being edited. The file is copied into the
/// draft folder on the spot, so a later save never depends on the original still
/// sitting where the user found it.
#[tauri::command]
pub async fn pet_editor_pick(app: AppHandle) -> Value {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let Ok(source) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "dialog.readFailed") });
    };
    let Some(sheet) = source.extension().and_then(|value| value.to_str()).and_then(draft_sheet_name)
    else {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.missingSheet") });
    };
    if source.metadata().map(|meta| meta.len()).unwrap_or(0) > MAX_PACK_BYTES {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "lite.pack.tooLarge") });
    }
    let dir = pack_draft_dir(&app);
    clear_draft(&app);
    if fs::create_dir_all(&dir).is_err() {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "dialog.copyFailed") });
    }
    let path = dir.join(&sheet);
    if fs::copy(&source, &path).is_err() {
        return json!({ "ok": false, "error": translate(&current_locale(&app), "dialog.copyFailed") });
    }
    let size = image::image_dimensions(&path).ok();
    json!({
        "ok": true,
        "sheet": sheet,
        "path": path.to_string_lossy(),
        "url": inline_image(&path),
        "width": size.map(|value| value.0),
        "height": size.map(|value| value.1),
    })
}

/// Save the edited pack: validate it, confirm the sheet really is the grid the
/// manifest claims, then swap it into `pets/<id>` and drop the draft. Whether the
/// pet then wears it is the card's decision, not this command's.
#[tauri::command]
pub fn pet_save(app: AppHandle, manifest: Value) -> Value {
    let locale = current_locale(&app);
    let normalized = match validate(&manifest, "") {
        Ok(normalized) => normalized,
        Err(error) => return json!({ "ok": false, "error": error_text(&app, error) }),
    };
    let draft = pack_draft_dir(&app);
    if let Err(error) = check_sheet(&draft, &normalized) {
        return json!({ "ok": false, "error": error_text(&app, error) });
    }
    let root = pets_dir(&app);
    if fs::create_dir_all(&root).is_err() {
        return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
    }
    let Ok(target) = write_pack(&draft, &root, &normalized) else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
    };
    match read_pack(&target) {
        Some(pet) => {
            clear_draft(&app);
            json!({ "ok": true, "pet": pet })
        }
        None => json!({ "ok": false, "error": translate(&locale, "lite.editor.saveFailed") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The id becomes a folder name, so nothing outside `[a-z0-9_-]` may survive.
    #[test]
    fn ids_are_folded_into_one_folder_name() {
        assert_eq!(slug("My Pack"), "my-pack");
        assert_eq!(slug("../../evil"), "evil");
        assert_eq!(slug("C:\\Users\\pet"), "c-users-pet");
        assert_eq!(slug("a/b"), "a-b");
        assert_eq!(slug(".."), "");
        assert_eq!(slug("  "), "");
        assert_eq!(slug("已导入"), "", "a name that folds away cannot be a folder");
        assert!(slug(&"x".repeat(200)).len() <= 64);
    }

    /// The sheet path has to stay inside the folder and be a drawable image.
    #[test]
    fn sheet_paths_cannot_escape_the_pack() {
        assert!(safe_sheet("sheet.png"));
        assert!(safe_sheet("art/pose.webp"));
        assert!(!safe_sheet(""));
        assert!(!safe_sheet("../outside.png"));
        assert!(!safe_sheet("art/../../outside.png"));
        assert!(!safe_sheet("/etc/sheet.png"));
        assert!(!safe_sheet("sheet.txt"));
        assert!(!safe_sheet("sheet"));
        // A drive letter or a UNC share is absolute *on Windows*. On Unix the same
        // string is one long file name with no separator in it — it cannot leave the
        // folder — so the invariant to assert is the one that holds everywhere
        // (below), not the Windows spelling of it. Asserting the Windows answer here
        // is what turned this file red on the macOS runner.
        #[cfg(windows)]
        {
            assert!(!safe_sheet("C:\\pets\\sheet.png"));
            assert!(!safe_sheet("\\\\server\\share\\sheet.png"));
        }
        // …and whatever the validator accepts has to stay inside the pack folder
        // once joined. (`join` throws the base away when handed an absolute path,
        // which is exactly the escape this guards against — those are refused.)
        let dir = Path::new("pets").join("demo");
        for sheet in ["sheet.png", "art/pose.webp", "C:\\pets\\sheet.png"] {
            if !safe_sheet(sheet) { continue; }
            let joined = dir.join(sheet);
            assert!(joined.starts_with(&dir), "{sheet} escaped the pack folder: {}", joined.display());
        }
    }

    /// 4 columns × 2 rows, so cells 0..8 exist and 8 does not.
    fn good_manifest() -> Value {
        json!({
            "schemaVersion": 1,
            "id": "demo",
            "displayName": "Demo",
            "assets": { "spritesheet": "sheet.png" },
            "sprite": { "frameWidth": 32, "frameHeight": 32, "columns": 4, "rows": 2, "scale": 1 },
            "animations": {
                "idle": { "frames": [0, 1] },
                "walk": { "frames": [4, 5, 6, 7], "fps": 12, "loop": true }
            }
        })
    }

    /// A complete manifest keeps its numbers and gets the two defaults filled in.
    #[test]
    fn a_good_manifest_normalizes() {
        let manifest = validate(&good_manifest(), "demo-folder").expect("valid");
        assert_eq!(manifest["id"], "demo");
        assert_eq!(manifest["displayName"], "Demo");
        assert_eq!(manifest["assets"]["spritesheet"], "sheet.png");
        assert_eq!(manifest["sprite"]["frameWidth"], 32);
        assert_eq!(manifest["sprite"]["columns"], 4);
        // fps is a float on the way out (12 and 12.0 are the same number, but
        // serde_json keeps 12 as an integer, so the expectation has to be too).
        assert_eq!(manifest["animations"]["walk"]["fps"], 12.0);
        assert_eq!(manifest["animations"]["walk"]["loop"], true);
        // fps defaults to 8 and loop to true, so an author can leave them out.
        assert_eq!(manifest["animations"]["idle"]["fps"], 8.0);
        assert_eq!(manifest["animations"]["idle"]["loop"], true);
        assert_eq!(manifest["source"], "imported");
        // The frame list survives in order — that order *is* the animation.
        assert_eq!(manifest["animations"]["walk"]["frames"][3], 7);
    }

    /// A folder name stands in when the manifest forgets to name itself.
    #[test]
    fn a_missing_id_falls_back_to_the_folder_name() {
        let mut raw = good_manifest();
        raw.as_object_mut().unwrap().remove("id");
        let manifest = validate(&raw, "My Pack").expect("valid");
        assert_eq!(manifest["id"], "my-pack");
        // The author did name it, so the display name is kept as written.
        assert_eq!(manifest["displayName"], "Demo");

        // With no id *and* no display name there is nothing left but the folder.
        let mut bare = good_manifest();
        bare.as_object_mut().unwrap().remove("id");
        bare.as_object_mut().unwrap().remove("displayName");
        let manifest = validate(&bare, "My Pack").expect("valid");
        assert_eq!(manifest["id"], "my-pack");
        assert_eq!(manifest["displayName"], "my-pack", "and it names itself after it");
    }

    /// Every refusal carries the key the settings panel turns into a sentence.
    #[test]
    fn bad_manifests_are_refused_with_a_reason() {
        let broken = |mutate: &dyn Fn(&mut Value)| {
            let mut raw = good_manifest();
            mutate(&mut raw);
            validate(&raw, "demo").err().map(|error| error.key)
        };
        assert_eq!(broken(&|raw| { raw["schemaVersion"] = json!(2); }), Some("lite.pack.badSchema"));
        assert_eq!(
            broken(&|raw| { raw["assets"]["spritesheet"] = json!("../sheet.png"); }),
            Some("lite.pack.missingSheet")
        );
        assert_eq!(broken(&|raw| { raw["sprite"]["columns"] = json!(0); }), Some("lite.pack.badSprite"));
        assert_eq!(
            broken(&|raw| { raw.as_object_mut().unwrap().remove("sprite"); }),
            Some("lite.pack.badSprite")
        );
        assert_eq!(broken(&|raw| { raw["animations"] = json!({}); }), Some("lite.pack.badAnimation"));
        assert_eq!(
            broken(&|raw| { raw["animations"]["idle"]["frames"] = json!([]); }),
            Some("lite.pack.badAnimation")
        );
        // A frame number past the end of the sheet is the classic authoring slip.
        assert_eq!(
            broken(&|raw| { raw["animations"]["idle"]["frames"] = json!([8]); }),
            Some("lite.pack.badAnimation")
        );
        assert_eq!(
            broken(&|raw| { raw["animations"]["idle"]["frames"] = json!([-1]); }),
            Some("lite.pack.badAnimation")
        );
        // A nonsense fps is replaced by the default rather than refused: it is a
        // preference, not a claim about the art.
        assert_eq!(broken(&|raw| { raw["animations"]["walk"]["fps"] = json!(0); }), None);
    }

    /// A pack with an unusable id is refused rather than written to a stray folder.
    #[test]
    fn an_unnamable_pack_is_refused() {
        let mut raw = good_manifest();
        raw["id"] = json!("已导入");
        let error = validate(&raw, "").err().expect("refused");
        assert_eq!(error.key, "lite.pack.badId");
    }

    /// Only drawable images get a draft name, and it never keeps the user's
    /// spelling of the extension (`.PNG` and `png` are the same file).
    #[test]
    fn draft_sheets_keep_only_drawable_extensions() {
        assert_eq!(draft_sheet_name("png").as_deref(), Some("sheet.png"));
        assert_eq!(draft_sheet_name(".WEBP").as_deref(), Some("sheet.webp"));
        assert_eq!(draft_sheet_name("jpeg").as_deref(), Some("sheet.jpeg"));
        assert_eq!(draft_sheet_name("bmp"), None);
        assert_eq!(draft_sheet_name(""), None);
    }

    /// A save builds the replacement off to the side and swaps it in, so the pack
    /// folder never ends up holding the new sheet beside the old manifest.
    #[test]
    fn saving_a_pack_replaces_its_folder_wholesale() {
        let root = std::env::temp_dir().join(format!("booloo-petpack-{}", std::process::id()));
        let draft = root.join("draft");
        let pets = root.join("pets");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&draft).unwrap();
        fs::write(draft.join("sheet.png"), b"new art").unwrap();
        // An older install of the same id, holding a file the new manifest drops.
        fs::create_dir_all(pets.join("demo")).unwrap();
        fs::write(pets.join("demo").join("stale.txt"), b"old").unwrap();

        let target = write_pack(&draft, &pets, &good_manifest()).expect("written");
        assert_eq!(target, pets.join("demo"));
        assert_eq!(fs::read(target.join("sheet.png")).unwrap(), b"new art");
        assert!(target.join(MANIFEST).is_file());
        assert!(!target.join("stale.txt").exists(), "the old folder is replaced, not merged");
        assert!(!pets.join("demo.staging").exists(), "and the staging copy does not linger");
        let _ = fs::remove_dir_all(&root);
    }
}
