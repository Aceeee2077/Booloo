// ============================================================================
// Prismoo (Tauri 2) — Rust backend entry point.
//
// The lightweight renderer talks to this process through lite-api.ts.
// ============================================================================
// The config defaults are a single large `json!` literal, which needs more macro
// recursion headroom than the default 128 once the schema grows.
#![recursion_limit = "512"]

mod config;
mod custom;
mod i18n;
mod tray;
mod window;

use tauri::{AppHandle, Manager};
use std::io::Write;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Reports collected by `probe_report` during a `PRISMOO_SELFCHECK` run.
static PET_REPORT: Mutex<Option<String>> = Mutex::new(None);
static SETTINGS_REPORT: Mutex<Option<String>> = Mutex::new(None);

/// Print a self-check line and flush immediately: when stdout is a pipe it is block
/// buffered, and a crash would otherwise swallow the diagnostics.
fn report(line: &str) {
    println!("[selfcheck] {line}");
    let _ = std::io::stdout().flush();
}

fn wait_for(slot: &Mutex<Option<String>>, timeout: Duration) -> Option<String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(value) = slot.lock().unwrap().clone() {
            return Some(value);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

#[tauri::command]
fn probe_report(payload: String) {
    let source = serde_json::from_str::<serde_json::Value>(&payload)
        .ok()
        .and_then(|value| {
            value
                .get("window")
                .and_then(|w| w.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    match source.as_str() {
        "settings" => *SETTINGS_REPORT.lock().unwrap() = Some(payload),
        _ => *PET_REPORT.lock().unwrap() = Some(payload),
    }
}

const LITE_CHECK_JS: &str = r#"
(async () => {
  await new Promise(resolve => setTimeout(resolve, 1200));
  const canvas = document.getElementById('pet-canvas');
  const out = { window: 'pet', hasApi: !!window.api, hasCanvas: !!canvas };
  try {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 24) visible++;
    out.drawnPixels = visible;
    out.state = window.__prismooLiteState?.() ?? null;
    out.hitTestCorner = window.__prismooHitTest?.(5, 5) ?? null;
    out.i18nReady = typeof window.liteT === 'function' && window.liteT('lite.pet.petting') !== 'lite.pet.petting';
    out.petError = window.__petError ?? null;
  } catch (error) { out.error = String(error); }
  await window.__TAURI__.core.invoke('probe_report', { payload: JSON.stringify(out) });
})();
"#;

const LITE_SETTINGS_CHECK_JS: &str = r#"
(async () => {
  const out = {
    window: 'settings', hasApi: !!window.api,
    skinChoices: document.querySelectorAll('#skins button').length,
    importButton: !!document.getElementById('choose-image'),
    confirmButton: !!document.getElementById('confirm-image'),
    hasLanguage: !!document.getElementById('language'),
    languageValue: document.getElementById('language')?.value ?? null,
    translatedQuit: typeof window.liteT === 'function' ? window.liteT('lite.menu.quit') : null,
    hasExtraPanels: !!document.getElementById('wardrobe-root') || !!document.getElementById('ai-enabled'),
  };
  try { out.configSkin = (await window.api.getConfig()).skin; }
  catch (error) { out.error = String(error); }
  await window.__TAURI__.core.invoke('probe_report', { payload: JSON.stringify(out) });
})();
"#;

/// Probe the two windows that ship with the lightweight app.
fn spawn_self_check(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(3500));
        if let Some(pet) = handle.get_webview_window("pet") {
            if let Err(error) = pet.eval(LITE_CHECK_JS) { eprintln!("[selfcheck] pet eval failed: {error}"); }
        }
        let pet = wait_for(&PET_REPORT, Duration::from_secs(15));
        report(&pet.clone().unwrap_or_else(|| r#"{"window":"pet","error":"timeout"}"#.into()));

        let opener = handle.clone();
        tauri::async_runtime::spawn(async move { let _ = window::open_settings(opener, None).await; });
        std::thread::sleep(Duration::from_millis(2500));
        match handle.get_webview_window("settings") {
            Some(panel) => {
                if let Err(error) = panel.eval(LITE_SETTINGS_CHECK_JS) { eprintln!("[selfcheck] settings eval failed: {error}"); }
            }
            None => report(r#"{"window":"settings","error":"settings window was not created"}"#),
        }
        let settings = wait_for(&SETTINGS_REPORT, Duration::from_secs(15));
        report(&settings.clone().unwrap_or_else(|| r#"{"window":"settings","error":"timeout"}"#.into()));

        if let Some(panel) = handle.get_webview_window("settings") {
            let _ = panel.eval("document.getElementById('close')?.click()");
        }
        let close_started = Instant::now();
        while handle.get_webview_window("settings").is_some()
            && close_started.elapsed() < Duration::from_secs(4)
        {
            std::thread::sleep(Duration::from_millis(100));
        }
        report(&format!(
            r#"{{"window":"settings_close","closed":{}}}"#,
            handle.get_webview_window("settings").is_none()
        ));

        let ok = pet.is_some() && settings.is_some();
        handle.exit(if ok { 0 } else { 1 });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered: it has to exit the process before any
        // other plugin (tray icon, windows, updater) gets a chance to set itself up.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch just surfaces the pet that is already running, which is
            // what the Electron build's requestSingleInstanceLock() did.
            if let Some(pet) = app.get_webview_window("pet") {
                let _ = pet.show();
                let _ = pet.unminimize();
                let _ = pet.set_focus();
            }
            if let Some(settings) = app.get_webview_window("settings") {
                let _ = settings.show();
                let _ = settings.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let config = config::init(app.handle());
            app.manage(config);
            app.manage(window::DragState::default());
            tray::build(app.handle())?;
            window::spawn_position_saver(app.handle());

            // Safety net: the pet window starts hidden and is revealed by
            // show_pet_window once the renderer is up. If that never happens (boot
            // failure), show it anyway so the app is never just a tray icon.
            let watchdog = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(4000));
                if let Some(pet) = watchdog.get_webview_window("pet") {
                    if !pet.is_visible().unwrap_or(true) {
                        let _ = pet.show();
                    }
                }
            });

            if std::env::var("PRISMOO_SELFCHECK").is_ok() {
                spawn_self_check(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_report,
            i18n::i18n_get,
            tray::show_pet_menu,
            tray::close_pet_menu,
            tray::pet_menu_action,
            window::window_move,
            window::window_move_to,
            window::window_center_target,
            window::window_position,
            window::window_center_here,
            window::drag_begin,
            window::drag_move,
            window::drag_end,
            window::set_click_through,
            window::cursor_in_window,
            window::window_edge_gaps,
            window::config_get,
            window::config_set,
            window::quit_app,
            window::open_settings,
            window::close_settings,
            custom::custom_get,
            custom::custom_pick_preview,
            custom::custom_commit,
            custom::custom_discard,
            custom::custom_clear,
            window::autolaunch_get,
            window::autolaunch_set,
            window::show_pet_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prismoo");
}
