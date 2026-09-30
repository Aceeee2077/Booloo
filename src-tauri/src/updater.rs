// ============================================================================
// Software updates — the Tauri counterpart of the Electron updater panel.
//
// The renderer already owns the update UI (settings panel + header badge); this
// module backs it with tauri-plugin-updater. The flow is exposed as plain commands
// so the existing `window.api` shim (src/renderer/tauri-api.ts) keeps working
// without the plugin's JS bindings or a bundler.
//
// Statuses mirror the `UpdateStatus` union in src/shared/types.ts.
// ============================================================================

use crate::config::ConfigState;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

/// Manual fallback URL, shown while the updater is not configured or a check fails.
const RELEASES_URL: &str = "https://github.com/Aceeee2077/Booloo/releases/latest";

/// Holds the verified installer bytes between `update_download` and `update_install`.
#[derive(Default)]
pub struct DownloadedState(pub Mutex<Option<Vec<u8>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressOut {
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStateOut {
    pub status: String,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<UpdateProgressOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_url: Option<String>,
    pub auto_check: bool,
    pub auto_download: bool,
    pub channel: String,
}

fn read_prefs(config: &ConfigState) -> (bool, bool, String) {
    (
        config.get("updateAutoCheck").as_bool().unwrap_or(true),
        config.get("updateAutoDownload").as_bool().unwrap_or(true),
        config
            .get("updateChannel")
            .as_str()
            .unwrap_or("stable")
            .to_string(),
    )
}

fn base_state(app: &AppHandle, config: &ConfigState, status: &str) -> UpdateStateOut {
    let (auto_check, auto_download, channel) = read_prefs(config);
    UpdateStateOut {
        status: status.to_string(),
        current_version: app.package_info().version.to_string(),
        version: None,
        progress: None,
        notes: None,
        error: None,
        manual_url: Some(RELEASES_URL.to_string()),
        auto_check,
        auto_download,
        channel,
    }
}

fn emit_state(app: &AppHandle, state: &UpdateStateOut) {
    let _ = app.emit("update-state", state.clone());
}

fn progress_state(
    current_version: &str,
    version: &str,
    channel: &str,
    auto_check: bool,
    auto_download: bool,
    transferred: u64,
    total: u64,
) -> UpdateStateOut {
    let percent = if total > 0 {
        (transferred as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    UpdateStateOut {
        status: "downloading".to_string(),
        current_version: current_version.to_string(),
        version: Some(version.to_string()),
        progress: Some(UpdateProgressOut {
            percent,
            transferred,
            total,
            bytes_per_second: 0,
        }),
        notes: None,
        error: None,
        manual_url: Some(RELEASES_URL.to_string()),
        auto_check,
        auto_download,
        channel: channel.to_string(),
    }
}

#[tauri::command]
pub fn update_get_state(app: AppHandle, config: State<'_, ConfigState>) -> UpdateStateOut {
    base_state(&app, &config, "idle")
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    config: State<'_, ConfigState>,
) -> Result<UpdateStateOut, String> {
    let mut state = base_state(&app, &config, "checking");
    emit_state(&app, &state);

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            state.status = "unsupported".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            state.status = "available".to_string();
            state.version = Some(update.version);
            state.notes = update.body;
            state.error = None;
        }
        Ok(None) => {
            state.status = "up-to-date".to_string();
            state.error = None;
        }
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
        }
    }
    emit_state(&app, &state);
    Ok(state)
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    config: State<'_, ConfigState>,
    downloaded: State<'_, DownloadedState>,
) -> Result<UpdateStateOut, String> {
    let mut state = base_state(&app, &config, "downloading");
    emit_state(&app, &state);

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            state.status = "up-to-date".to_string();
            state.error = None;
            emit_state(&app, &state);
            return Ok(state);
        }
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let current_version = app.package_info().version.to_string();
    let version = update.version.clone();
    let (auto_check, auto_download, channel) = read_prefs(&config);

    let app_cb = app.clone();
    let cv = current_version.clone();
    let ver = version.clone();
    let ch = channel.clone();

    let mut transferred: u64 = 0;
    let mut total: u64 = 0;
    let bytes = update
        .download(
            move |chunk_len, content_len| {
                transferred += chunk_len as u64;
                if let Some(n) = content_len {
                    total = n;
                }
                let progress = progress_state(
                    &cv,
                    &ver,
                    &ch,
                    auto_check,
                    auto_download,
                    transferred,
                    total,
                );
                let _ = app_cb.emit("update-state", progress);
            },
            || {},
        )
        .await;

    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    *downloaded.0.lock().unwrap() = Some(bytes);

    state.status = "downloaded".to_string();
    state.version = Some(version);
    state.progress = None;
    state.error = None;
    emit_state(&app, &state);
    Ok(state)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    downloaded: State<'_, DownloadedState>,
) -> Result<(), String> {
    let bytes = downloaded
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no downloaded update".to_string())?;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update.install(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_install_when_ready(
    app: AppHandle,
    config: State<'_, ConfigState>,
) -> Result<UpdateStateOut, String> {
    let mut state = base_state(&app, &config, "downloading");
    emit_state(&app, &state);

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            state.status = "up-to-date".to_string();
            state.error = None;
            emit_state(&app, &state);
            return Ok(state);
        }
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let current_version = app.package_info().version.to_string();
    let version = update.version.clone();
    let (auto_check, auto_download, channel) = read_prefs(&config);

    let app_cb = app.clone();
    let cv = current_version.clone();
    let ver = version.clone();
    let ch = channel.clone();

    let mut transferred: u64 = 0;
    let mut total: u64 = 0;
    let result = update
        .download_and_install(
            move |chunk_len, content_len| {
                transferred += chunk_len as u64;
                if let Some(n) = content_len {
                    total = n;
                }
                let progress = progress_state(
                    &cv,
                    &ver,
                    &ch,
                    auto_check,
                    auto_download,
                    transferred,
                    total,
                );
                let _ = app_cb.emit("update-state", progress);
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => {
            // On Windows this launches the installer and exits before returning.
            state.status = "downloaded".to_string();
            state.version = Some(version);
            state.progress = None;
            state.error = None;
        }
        Err(err) => {
            state.status = "error".to_string();
            state.error = Some(err.to_string());
        }
    }
    emit_state(&app, &state);
    Ok(state)
}
