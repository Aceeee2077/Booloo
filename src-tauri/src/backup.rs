// ============================================================================
// Data backup — the whole data folder out to a folder the user picks, and back.
//
// Everything the user has made lives in one directory (%APPCONFIG%): `config.json`
// (settings, affinity, and the daily counters the reports read), `pets/` (imported
// pet packs) and `custom/` (the imported picture). Moving to a new machine, or
// backing out of a bad experiment, means getting those out and back in one piece.
//
// A backup is a *folder*, not an archive: this project ships no compression crate,
// and a folder the user can open, read and hand-copy is the more useful artifact.
// Export writes `booloo-backup-<date>/` under the picked folder; import takes one
// back.
//
// Restoring REPLACES the current data as a whole — merging would leave half of each
// version behind and produce a state neither backup describes. Because that is
// destructive, the import first copies what is there now to `data-before-restore/`
// beside the live data, so a wrong pick is one more restore away from being undone.
// ============================================================================

use crate::config::ConfigState;
use crate::i18n::translate;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// Prefix of an exported backup folder, followed by the date it was made.
const PREFIX: &str = "booloo-backup-";
/// Where the pre-restore copy is kept, under the data directory.
const ARCHIVE: &str = "data-before-restore";
/// The parts of the data directory a backup holds. `logs/` is deliberately left
/// out: it is a bug-report artifact, not something worth carrying between machines.
const PARTS: [&str; 3] = ["config.json", "pets", "custom"];

/// The directory the app keeps its data in — the same one `config.rs` writes to.
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<ConfigState>()
        .and_then(|state| state.get("locale").as_str().map(str::to_string))
        .unwrap_or_else(|| "zh".to_string())
}

/// Copy a tree, skipping anything that is not a plain file or directory.
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

/// Copy one part of a data directory into `to`. A part that is not there is not
/// an error — a fresh install may simply never have created it.
fn copy_part(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = match fs::symlink_metadata(from) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if meta.is_dir() {
        copy_tree(from, to)
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from, to).map(|_| ())
    }
}

/// Delete one part of a data directory, file or folder. Missing is fine.
fn remove_part(path: &Path) -> std::io::Result<()> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

/// Put the backup's copy of one part in place of the live one — replace, not merge.
///
/// A part the backup never held leaves the live one deleted, which is the point
/// of "replace": the result is exactly what the backup describes.
fn replace_part(data: &Path, backup: &Path, name: &str) -> std::io::Result<()> {
    let live = data.join(name);
    remove_part(&live)?;
    copy_part(&backup.join(name), &live)
}

/// Whether two paths point at the same directory (best effort — a plain
/// comparison when either cannot be canonicalized).
fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// The backup folder inside (or equal to) what the user picked.
///
/// A pick is used as-is when it looks like a backup (holds `config.json`), or when
/// it holds folders of the kind `backup_export` makes. That lets a user pick either
/// `booloo-backup-2026-10-14/` itself or the folder containing it; the newest match
/// wins when the parent holds several.
fn find_backup(picked: &Path) -> Option<PathBuf> {
    if picked.join("config.json").is_file() {
        return Some(picked.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = fs::read_dir(picked)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().starts_with(PREFIX))
                .unwrap_or(false)
                && path.join("config.json").is_file()
        })
        .collect();
    candidates.sort();
    candidates.pop()
}

/// Copy `config.json`, `pets/` and `custom/` into a dated folder the user picks.
#[tauri::command]
pub async fn backup_export(app: AppHandle) -> Value {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let locale = current_locale(&app);
    let Ok(destination) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.readFailed") });
    };
    // The date is the local day, so two exports on one day share a folder rather
    // than scatter the same date twice.
    let stamp = crate::logfile::timestamp();
    let date = stamp.split(' ').next().unwrap_or_default();
    let target = destination.join(format!("{PREFIX}{date}"));
    // An export is a snapshot, not an append: clear a same-day folder first so a
    // pet removed since the last export does not survive in it.
    let _ = remove_part(&target);
    let data = data_dir(&app);
    for name in PARTS {
        if let Err(error) = copy_part(&data.join(name), &target.join(name)) {
            crate::logfile::error(format!("backup export could not copy '{name}': {error}"));
            return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
        }
    }
    crate::logfile::info(format!("exported a backup to {}", target.to_string_lossy()));
    json!({ "ok": true, "path": target.to_string_lossy() })
}

/// Replace the current data with a backup the user picks.
///
/// What is there now is copied to `data-before-restore/` first, then each part is
/// swapped for the backup's copy. The restored config is loaded into the running
/// state and broadcast, so the open windows update in place; a restart is still
/// asked for, because the pet reads its sprite and pack only at startup.
#[tauri::command]
pub async fn backup_import(app: AppHandle) -> Value {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| { let _ = sender.send(path); });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let locale = current_locale(&app);
    let Ok(selection) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.readFailed") });
    };
    let Some(backup) = find_backup(&selection) else {
        return json!({ "ok": false, "error": translate(&locale, "lite.backup.notBackup") });
    };
    let data = data_dir(&app);
    // Picking the live data folder is a no-op, not a catastrophe: it would "archive"
    // and then "restore" the same bytes, and deleting the source before copying is
    // exactly how that would go wrong.
    if same_dir(&backup, &data) {
        return json!({ "ok": false, "error": translate(&locale, "lite.backup.notBackup") });
    }
    // Keep what is there now, so a wrong pick is one more restore away from undone.
    let archive = data.join(ARCHIVE);
    let _ = remove_part(&archive);
    for name in PARTS {
        if let Err(error) = copy_part(&data.join(name), &archive.join(name)) {
            crate::logfile::error(format!("the pre-restore copy could not save '{name}': {error}"));
            return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
        }
    }
    for name in PARTS {
        if let Err(error) = replace_part(&data, &backup, name) {
            crate::logfile::error(format!("the restore could not replace '{name}': {error}"));
            return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
        }
    }
    // Adopt the restored config in the running state and tell the windows. A config
    // that cannot be read back is not fatal: the file is in place, and the next
    // launch loads it.
    let restored = fs::read_to_string(data.join("config.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    match restored {
        Some(value) => {
            if let Some(state) = app.try_state::<ConfigState>() {
                let merged = state.replace(value);
                let _ = app.emit("config-changed", merged);
            }
        }
        None => crate::logfile::warn(
            "the restored config could not be read back; a restart will load it",
        ),
    }
    crate::logfile::info(format!("restored a backup from {}", backup.to_string_lossy()));
    json!({ "ok": true, "path": backup.to_string_lossy() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("booloo-backup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The recursive copy that carries `pets/` and `custom/` whole.
    #[test]
    fn copy_tree_keeps_nested_folders() {
        let dir = scratch("tree");
        let from = dir.join("from");
        fs::create_dir_all(from.join("nested/deeper")).unwrap();
        fs::write(from.join("top.txt"), b"top").unwrap();
        fs::write(from.join("nested/deeper/leaf.txt"), b"leaf").unwrap();

        let to = dir.join("to");
        copy_tree(&from, &to).unwrap();

        assert_eq!(fs::read_to_string(to.join("top.txt")).unwrap(), "top");
        assert_eq!(fs::read_to_string(to.join("nested/deeper/leaf.txt")).unwrap(), "leaf");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A restore replaces: a pet the backup does not have must be gone afterwards,
    /// not left behind from the running copy.
    #[test]
    fn replace_part_drops_what_the_backup_lacks() {
        let dir = scratch("replace");
        let data = dir.join("data");
        let backup = dir.join("backup");
        fs::create_dir_all(data.join("pets/old")).unwrap();
        fs::write(data.join("pets/old/keep.txt"), b"stale").unwrap();
        fs::create_dir_all(backup.join("pets/new")).unwrap();
        fs::write(backup.join("pets/new/keep.txt"), b"fresh").unwrap();

        replace_part(&data, &backup, "pets").unwrap();

        assert!(!data.join("pets/old").exists(), "the pet the backup lacks is removed");
        assert_eq!(fs::read_to_string(data.join("pets/new/keep.txt")).unwrap(), "fresh");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A part the backup never held is cleared, so the result is exactly what the
    /// backup describes rather than a mix of both.
    #[test]
    fn replace_part_clears_a_part_the_backup_never_had() {
        let dir = scratch("clear");
        let data = dir.join("data");
        let backup = dir.join("backup");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(data.join("config.json"), b"{}").unwrap();

        replace_part(&data, &backup, "config.json").unwrap();

        assert!(!data.join("config.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A pick is understood both as the backup folder itself and as its parent;
    /// anything that does not look like a backup is refused rather than guessed at.
    #[test]
    fn find_backup_accepts_the_folder_or_its_parent() {
        let dir = scratch("find");
        let backup = dir.join("booloo-backup-2026-10-14");
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("config.json"), b"{}").unwrap();

        assert_eq!(find_backup(&backup), Some(backup.clone()), "the folder itself");
        assert_eq!(find_backup(&dir), Some(backup.clone()), "the folder holding it");

        let empty = dir.join("elsewhere");
        fs::create_dir_all(&empty).unwrap();
        assert_eq!(find_backup(&empty), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
