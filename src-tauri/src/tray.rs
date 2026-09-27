// ============================================================================
// Tray icon + warm-colored pet / tray context menu.
// ============================================================================

use crate::config::ConfigState;
use crate::i18n::translate;
use tauri::image::Image;
#[cfg(target_os = "linux")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const TRAY_ID: &str = "main";

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<ConfigState>()
        .and_then(|state| state.get("locale").as_str().map(str::to_string))
        .unwrap_or_else(|| "zh".to_string())
}

/// Build the tray / context menu with the active locale's labels.
#[cfg(target_os = "linux")]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let locale = current_locale(app);
    let label = |key: &str| translate(&locale, key);

    let settings = MenuItem::with_id(app, "settings", label("menu.settings"), true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", label("menu.resetPos"), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", label("menu.quit"), true, None::<&str>)?;

    Menu::with_items(app, &[&settings, &reset, &separator, &quit])
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "settings" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::window::open_settings(app, None).await;
            });
        }
        "reset" => crate::window::center_pet(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let locale = current_locale(app);
    #[cfg(target_os = "linux")]
    let menu = build_menu(app)?;
    let icon = Image::from_bytes(include_bytes!("../../src/assets/tray.png"))?;

    let builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon);
    // Linux does not emit tray click events; keep its native menu there.
    #[cfg(target_os = "linux")]
    let builder = builder.menu(&menu);
    builder
        // Left click opens Settings, so the menu must not also pop on left click.
        .show_menu_on_left_click(false)
        .tooltip(translate(&locale, "tray.tooltip"))
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, position, .. } = event {
                let app = tray.app_handle().clone();
                match button {
                    MouseButton::Left => { tauri::async_runtime::spawn(async move {
                        let _ = crate::window::open_settings(app, None).await;
                    }); }
                    MouseButton::Right => { tauri::async_runtime::spawn(async move {
                        let _ = show_menu_at(&app, position);
                    }); }
                    _ => {}
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Re-label the tray after a locale switch.
pub fn rebuild(app: &AppHandle) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let locale = current_locale(app);
    #[cfg(target_os = "linux")]
    tray.set_menu(Some(build_menu(app)?))?;
    tray.set_tooltip(Some(translate(&locale, "tray.tooltip")))?;
    Ok(())
}

#[tauri::command]
pub async fn show_pet_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let pointer = window.cursor_position().map_err(|e| e.to_string())?;
    show_menu_at(&app, pointer)
}

fn show_menu_at(app: &AppHandle, pointer: PhysicalPosition<f64>) -> Result<(), String> {
    let menu = if let Some(existing) = app.get_webview_window("pet-menu") {
        existing
    } else {
        WebviewWindowBuilder::new(app, "pet-menu", WebviewUrl::App("renderer/menu.html".into()))
            .title("Prismoo menu")
            .inner_size(188.0, 284.0)
            .decorations(false)
            .resizable(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?
    };
    let size = menu.outer_size().map_err(|e| e.to_string())?;
    let pet = app.get_webview_window("pet").ok_or("pet window missing")?;
    let monitors = pet.available_monitors().map_err(|e| e.to_string())?;
    let area = monitors.iter().find_map(|monitor| {
        let area = monitor.work_area();
        let x = pointer.x as i32;
        let y = pointer.y as i32;
        (x >= area.position.x && x < area.position.x + area.size.width as i32 &&
         y >= area.position.y && y < area.position.y + area.size.height as i32)
            .then_some(*area)
    }).or_else(|| pet.current_monitor().ok().flatten().map(|m| *m.work_area()));
    let (mut x, mut y) = (pointer.x.round() as i32 + 8, pointer.y.round() as i32 + 8);
    if let Some(area) = area {
        let left = area.position.x;
        let top = area.position.y;
        let right = left + area.size.width as i32;
        let bottom = top + area.size.height as i32;
        if x + size.width as i32 > right { x = pointer.x.round() as i32 - size.width as i32 - 8; }
        if y + size.height as i32 > bottom { y = pointer.y.round() as i32 - size.height as i32 - 8; }
        x = x.clamp(left, (right - size.width as i32).max(left));
        y = y.clamp(top, (bottom - size.height as i32).max(top));
    }
    menu.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())?;
    let _ = menu.set_focus();
    Ok(())
}

#[tauri::command]
pub fn close_pet_menu(app: AppHandle) -> Result<(), String> {
    if let Some(menu) = app.get_webview_window("pet-menu") {
        menu.hide().map_err(|e| e.to_string())?;
        menu.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pet_menu_action(app: AppHandle, action: String) -> Result<(), String> {
    let _ = close_pet_menu(app.clone());
    if let Some(name) = action.strip_prefix("action:") {
        if matches!(name, "wave" | "groom" | "stretch" | "yawn") {
            return app.emit_to("pet", "pet-action", name).map_err(|e| e.to_string());
        }
    }
    match action.as_str() {
        "settings" => crate::window::open_settings(app, None).await,
        "reset" => { crate::window::center_pet(&app); Ok(()) },
        "quit" => { app.exit(0); Ok(()) },
        _ => Err("unknown menu action".into()),
    }
}
