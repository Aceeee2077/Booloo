// ============================================================================
// Window commands — pet-window movement, dragging and click-through.
//
// Electron exposed `setIgnoreMouseEvents(true, { forward: true })`, which keeps
// forwarding mousemove while the window is click-through. Tauri has no `forward`
// flag, so the renderer still owns the alpha hit-test and simply toggles
// click-through as the cursor enters/leaves the pet's opaque pixels.
// ============================================================================

use crate::config::ConfigState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

/// Anchor captured when a drag starts, so the window tracks the cursor delta
/// instead of accumulating per-move rounding error.
#[derive(Clone, Copy)]
pub struct DragAnchor {
    win_x: i32,
    win_y: i32,
    cur_x: f64,
    cur_y: f64,
    visual_bounds: Option<VisualBounds>,
}

/// Opaque body bounds in the renderer's 300px CSS canvas. The transparent window
/// padding is deliberately excluded from edge collision and snapping.
#[derive(Clone, Copy, Deserialize)]
pub struct VisualBounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct DragState(pub Mutex<Option<DragAnchor>>);

/// Read a boolean setting from the persisted config.
fn config_bool(window: &WebviewWindow, key: &str, fallback: bool) -> bool {
    window
        .app_handle()
        .try_state::<ConfigState>()
        .and_then(|state| state.get(key).as_bool())
        .unwrap_or(fallback)
}

/// Keep the window fully inside its allowed area, so the pet can never be walked or
/// dragged off-screen. By default that area is the current monitor's work area (the
/// taskbar is respected); with "cross monitors" enabled it becomes the bounding box
/// of every monitor instead.
fn clamp_to_monitor(window: &WebviewWindow, x: i32, y: i32, visual: Option<VisualBounds>) -> (i32, i32) {
    let stay_on_one = config_bool(window, "stayOnOneDisplay", true);
    let visual = if config_bool(window, "snapToEdge", false) { visual } else { None };
    clamp_to(window, x, y, !stay_on_one, visual)
}

/// Bounding rectangle the pet must stay inside: either its current monitor's work
/// area, or the union of every monitor's work area.
fn bounds(window: &WebviewWindow, all_monitors: bool) -> Option<(i32, i32, i32, i32)> {
    if !all_monitors {
        let monitor = window.current_monitor().ok().flatten()?;
        let area = monitor.work_area();
        return Some((
            area.position.x,
            area.position.y,
            area.size.width as i32,
            area.size.height as i32,
        ));
    }

    let monitors = window.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for monitor in monitors {
        let area = monitor.work_area();
        min_x = min_x.min(area.position.x);
        min_y = min_y.min(area.position.y);
        max_x = max_x.max(area.position.x + area.size.width as i32);
        max_y = max_y.max(area.position.y + area.size.height as i32);
    }
    Some((min_x, min_y, max_x - min_x, max_y - min_y))
}

fn physical_visual(window: &WebviewWindow, visual: Option<VisualBounds>) -> Option<(i32, i32, i32, i32)> {
    let visual = visual?;
    let scale = window.scale_factor().ok()?;
    let size = window.outer_size().ok()?;
    if ![visual.x, visual.y, visual.w, visual.h].iter().all(|n| n.is_finite())
        || visual.w < 1.0 || visual.h < 1.0
    {
        return None;
    }
    let x0 = (visual.x * scale).floor() as i32;
    let y0 = (visual.y * scale).floor() as i32;
    let x1 = ((visual.x + visual.w) * scale).ceil() as i32;
    let y1 = ((visual.y + visual.h) * scale).ceil() as i32;
    // A bad renderer rectangle must never let the entire window disappear.
    if x0 < 0 || y0 < 0 || x1 > size.width as i32 || y1 > size.height as i32 {
        return None;
    }
    Some((x0, y0, x1, y1))
}

fn clamp_position(x: i32, y: i32, area: (i32, i32, i32, i32), visible: (i32, i32, i32, i32)) -> (i32, i32) {
    let (bx, by, bw, bh) = area;
    let (vx0, vy0, vx1, vy1) = visible;
    let min_x = bx - vx0;
    let min_y = by - vy0;
    let max_x = (bx + bw - vx1).max(min_x);
    let max_y = (by + bh - vy1).max(min_y);
    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

#[cfg(test)]
mod edge_tests {
    use super::clamp_position;

    #[test]
    fn allows_transparent_padding_outside_each_work_area_edge() {
        let area = (0, 0, 1920, 1040);
        // The pet occupies only x=100..200, y=170..290 inside a 300px window.
        let visible = (100, 170, 200, 290);
        assert_eq!(clamp_position(-500, 300, area, visible).0, -100);
        assert_eq!(clamp_position(2500, 300, area, visible).0, 1720);
        assert_eq!(clamp_position(600, 2500, area, visible).1, 750);
        assert_eq!(clamp_position(600, -500, area, visible).1, -170);
    }

    #[test]
    fn whole_window_bounds_remain_available_when_snapping_is_off() {
        let area = (0, 0, 1920, 1040);
        let window = (0, 0, 300, 300);
        assert_eq!(clamp_position(-100, 1000, area, window), (0, 740));
    }
}

fn clamp_to(window: &WebviewWindow, x: i32, y: i32, all_monitors: bool, visual: Option<VisualBounds>) -> (i32, i32) {
    let Ok(size) = window.outer_size() else {
        return (x, y);
    };
    let Some((bx, by, bw, bh)) = bounds(window, all_monitors) else {
        return (x, y);
    };
    let visible = physical_visual(window, visual)
        .unwrap_or((0, 0, size.width as i32, size.height as i32));
    clamp_position(x, y, (bx, by, bw, bh), visible)
}

/// How much room the pet's visible box has before it touches the work-area sides.
///
/// The animation system uses this to stop a walk at the screen edge and to satisfy
/// `nearScreenEdge` behavior conditions. Computed here rather than in the renderer
/// because only the main process knows the monitor's scale factor — comparing CSS
/// pixels from the page against physical window coordinates is wrong on any
/// display that is not at 100%.
#[tauri::command]
pub fn window_edge_gaps(window: WebviewWindow, visual: Option<VisualBounds>) -> Value {
    let Ok(size) = window.outer_size() else {
        return json!({ "left": 0, "right": 0, "bottom": 0, "workWidth": 0, "workHeight": 0 });
    };
    let Ok(position) = window.outer_position() else {
        return json!({ "left": 0, "right": 0, "bottom": 0, "workWidth": 0, "workHeight": 0 });
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let visible = physical_visual(&window, visual)
        .unwrap_or((0, 0, size.width as i32, size.height as i32));
    // Follow the pet onto whichever display it currently sits on.
    let area = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let work = monitor.work_area();
            (
                work.position.x,
                work.position.y,
                work.size.width as i32,
                work.size.height as i32,
            )
        })
        .or_else(|| bounds(&window, false));
    let Some((bx, by, bw, bh)) = area else {
        return json!({ "left": 0, "right": 0, "bottom": 0, "workWidth": 0, "workHeight": 0 });
    };
    let (vx0, _vy0, vx1, vy1) = visible;
    let left = (position.x + vx0) - bx;
    let right = (bx + bw) - (position.x + vx1);
    let bottom = (by + bh) - (position.y + vy1);
    json!({
        "left": left.max(0),
        "right": right.max(0),
        "bottom": bottom.max(0),
        "workWidth": bw,
        "workHeight": bh,
        "scale": scale,
    })
}

// ---------- Position memory ----------

fn position_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("position.json")
}

fn read_position(app: &AppHandle) -> Option<(i32, i32)> {
    let raw = fs::read_to_string(position_path(app)).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    Some((
        value.get("x")?.as_i64()? as i32,
        value.get("y")?.as_i64()? as i32,
    ))
}

/// Poll the pet window's position and persist it when it changes.
///
/// Polling is deliberate: the window moves from drags, the auto-walk loop and the
/// auto-jump parabola, and hooking every one of those would mean a file write per
/// frame. A 1.5 s tick is far below anyone's patience and costs nothing.
pub fn spawn_position_saver(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut last: Option<(i32, i32)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let Some(pet) = handle.get_webview_window("pet") else {
                continue;
            };
            let Ok(position) = pet.outer_position() else {
                continue;
            };
            let current = (position.x, position.y);
            if last != Some(current) {
                last = Some(current);
                let payload = serde_json::json!({ "x": current.0, "y": current.1 }).to_string();
                let _ = fs::write(position_path(&handle), payload);
            }
        }
    });
}

/// Restore the remembered position, then reveal the pet window.
///
/// The window is declared hidden in tauri.conf.json so it never flashes at the
/// centre of the screen before moving to where it belongs.
#[tauri::command]
pub async fn show_pet_window(app: AppHandle) -> Result<(), String> {
    let Some(pet) = app.get_webview_window("pet") else {
        return Ok(());
    };

    // The OS applies the window's creation geometry asynchronously, so anything set
    // immediately after the window is built gets overwritten and the pet lands in the
    // corner. Let that settle, then position, then reveal — no wrong-position flash.
    std::thread::sleep(Duration::from_millis(300));

    match read_position(&app) {
        Some((x, y)) => {
            // Clamp against every monitor: a position saved on a display that is now
            // unplugged must land back on-screen, not be pulled to the primary.
            // Keep remembered partially off-screen placements if the window centre
            // still belongs to a connected display (edge-snapped pets use these).
            let size = pet.outer_size().map_err(|e| e.to_string())?;
            let margin_x = size.width as i32 / 3;
            let margin_y = size.height as i32 / 3;
            let area = bounds(&pet, true);
            let (x, y) = area.map(|area| clamp_position(
                x, y, area,
                (margin_x, margin_y, size.width as i32 - margin_x, size.height as i32 - margin_y),
            )).unwrap_or((x, y));
            let _ = pet.set_position(PhysicalPosition::new(x, y));
        }
        // First run (or a forgotten position): start centred.
        None => {
            let _ = center_on_work_area(&pet);
        }
    }
    pet.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_move(window: WebviewWindow, dx: i32, dy: i32, visual_bounds: Option<VisualBounds>) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let (x, y) = clamp_to_monitor(&window, position.x + dx, position.y + dy, visual_bounds);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_move_to(window: WebviewWindow, x: i32, y: i32, visual_bounds: Option<VisualBounds>) -> Result<(), String> {
    let (x, y) = clamp_to_monitor(&window, x, y, visual_bounds);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_position(window: WebviewWindow) -> Result<(i32, i32), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    Ok((position.x, position.y))
}

#[tauri::command]
pub fn window_center_here(window: WebviewWindow) -> Result<(), String> {
    center_on_work_area(&window)
}

fn centered_visual_position(area: (i32, i32, i32, i32), visual: (i32, i32, i32, i32)) -> (i32, i32) {
    let (x, y, width, height) = area;
    let (vx0, vy0, vx1, vy1) = visual;
    (x + width / 2 - (vx0 + vx1) / 2, y + height / 2 - (vy0 + vy1) / 2)
}

/// Where the window should move so the visible pet, rather than transparent
/// padding around it, ends up in the middle of the current work area.
#[tauri::command]
pub fn window_center_target(window: WebviewWindow, visual_bounds: Option<VisualBounds>) -> Result<(i32, i32), String> {
    let monitor = window.current_monitor().map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?);
    let Some(monitor) = monitor else { return window_position(window); };
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let area = monitor.work_area();
    let visual = physical_visual(&window, visual_bounds)
        .unwrap_or((0, 0, size.width as i32, size.height as i32));
    Ok(centered_visual_position((area.position.x, area.position.y,
        area.size.width as i32, area.size.height as i32), visual))
}

#[cfg(test)]
mod reminder_tests {
    use super::centered_visual_position;

    #[test]
    fn centers_the_visible_pet_instead_of_its_transparent_window() {
        let position = centered_visual_position((0, 0, 1920, 1040), (84, 160, 216, 292));
        assert_eq!(position, (810, 294));
        assert_eq!(position.0 + (84 + 216) / 2, 960);
        assert_eq!(position.1 + (160 + 292) / 2, 520);
    }
}

/// Centre the window on the work area (not the full monitor) of the display it is on.
///
/// The window config's `center: true` did not take effect — the pet kept landing at
/// the bottom-left of the work area — so centring is done explicitly instead.
fn center_on_work_area(window: &WebviewWindow) -> Result<(), String> {
    let monitor = match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor().map_err(|e| e.to_string())?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let area = monitor.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Center the pet window on its current monitor (used by the tray / context menu).
pub fn center_pet(app: &AppHandle) {
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = window_center_here(pet);
    }
}

#[tauri::command]
pub fn drag_begin(window: WebviewWindow, state: State<'_, DragState>, visual_bounds: Option<VisualBounds>) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(DragAnchor {
        win_x: position.x,
        win_y: position.y,
        cur_x: cursor.x,
        cur_y: cursor.y,
        visual_bounds,
    });
    Ok(())
}

#[tauri::command]
pub fn drag_move(window: WebviewWindow, state: State<'_, DragState>) -> Result<(), String> {
    let anchor = *state.0.lock().unwrap();
    let Some(anchor) = anchor else {
        return Ok(());
    };
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let x = anchor.win_x + (cursor.x - anchor.cur_x).round() as i32;
    let y = anchor.win_y + (cursor.y - anchor.cur_y).round() as i32;
    let (x, y) = clamp_to_monitor(&window, x, y, anchor.visual_bounds);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn drag_end(window: WebviewWindow, state: State<'_, DragState>, visual_bounds: Option<VisualBounds>) {
    *state.0.lock().unwrap() = None;
    if config_bool(&window, "snapToEdge", false) {
        snap_to_edge(&window, visual_bounds);
    }
}

/// Snap flush to the nearest work-area edge when the pet is dropped close to it.
fn snap_to_edge(window: &WebviewWindow, visual_bounds: Option<VisualBounds>) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let left = area.position.x;
    let top = area.position.y;
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let (vx0, vy0, vx1, vy1) = physical_visual(window, visual_bounds)
        .unwrap_or((0, 0, size.width as i32, size.height as i32));
    let threshold = (28.0 * window.scale_factor().unwrap_or(1.0)).round() as i32;

    let mut x = position.x;
    let mut y = position.y;
    if (position.x + vx0 - left).abs() <= threshold {
        x = left - vx0;
    } else if (right - (position.x + vx1)).abs() <= threshold {
        x = right - vx1;
    }
    if (position.y + vy0 - top).abs() <= threshold {
        y = top - vy0;
    } else if (bottom - (position.y + vy1)).abs() <= threshold {
        y = bottom - vy1;
    }

    if x != position.x || y != position.y {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[tauri::command]
pub fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
}

/// Cursor position in window-local CSS pixels, or None when it is outside the window.
///
/// Electron forwarded mousemove events to a click-through window; Tauri does not, so
/// once the pet becomes click-through nothing in the renderer can notice the cursor
/// coming back. The renderer polls this instead and re-enables interaction itself.
#[tauri::command]
pub fn cursor_in_window(window: WebviewWindow) -> Result<Option<(f64, f64)>, String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    let x = (cursor.x - position.x as f64) / scale;
    let y = (cursor.y - position.y as f64) / scale;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    if x < 0.0 || y < 0.0 || x >= width || y >= height {
        Ok(None)
    } else {
        Ok(Some((x, y)))
    }
}

#[tauri::command]
pub fn config_get(state: State<'_, ConfigState>) -> Value {
    state.snapshot()
}

#[tauri::command]
pub fn config_set(app: AppHandle, state: State<'_, ConfigState>, patch: Value) -> Value {
    let locale_before = state
        .get("locale")
        .as_str()
        .unwrap_or("zh")
        .to_string();
    let merged = state.apply(&patch);
    state.persist();
    let _ = app.emit("config-changed", merged.clone());

    // The tray labels / tooltip are localized, so a language switch re-labels them.
    let locale_after = state.get("locale").as_str().unwrap_or("zh").to_string();
    if locale_before != locale_after {
        let _ = crate::tray::rebuild(&app);
    }
    merged
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Open (or focus) the settings panel.
///
/// `async` is load-bearing: Tauri runs sync commands on the main thread, and building
/// a webview window from there deadlocks — the outer frame appears but its webview
/// never initialises, so the window stays blank white and the app stops responding
/// (tray included). Async commands run on the runtime's thread pool instead, which
/// leaves the main thread free to service the window creation.
#[tauri::command]
pub async fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        // Already open: just tell it which section to scroll to (the wardrobe
        // entry in the pet's right-click menu relies on this).
        if let Some(section) = section {
            let _ = existing.emit("settings-focus-section", section);
        }
        return Ok(());
    }
    build_settings(&app, section)
}

/// Close the native settings window, including its transparent host surface.
#[tauri::command]
pub fn close_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        // Hide first so Windows drops the compositor surface before the webview is
        // destroyed. `window.close()` in the page can leave that surface visible.
        window.hide().map_err(|e| e.to_string())?;
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open (or focus) the cutout mask editor for the image staged by the settings
/// panel. `async` for the same reason `open_settings` is: building a webview from
/// a sync command runs on the main thread and deadlocks.
#[tauri::command]
pub async fn open_mask_editor(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("mask") {
        let _ = existing.show();
        let _ = existing.set_focus();
        // A second pick while the editor is already up reloads it in place.
        let _ = existing.emit("mask-reload", ());
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "mask",
        tauri::WebviewUrl::App("renderer/mask.html".into()),
    )
    .title("Prismoo")
    .decorations(false)
    .inner_size(1080.0, 720.0)
    .min_inner_size(760.0, 520.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    let _ = window;
    Ok(())
}

/// Close the cutout mask editor. Cancelling the edit is the renderer's job (the
/// staged file simply stays in place); this only tears the window down.
#[tauri::command]
pub fn close_mask_editor(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mask") {
        window.hide().map_err(|e| e.to_string())?;
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_settings(app: &AppHandle, section: Option<String>) -> Result<(), String> {
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "settings",
        tauri::WebviewUrl::App("renderer/settings.html".into()),
    )
    .title("Prismoo")
    .decorations(false)
    // Wide enough for the 53-week click heatmap to show a whole year without a
    // horizontal scrollbar: the page needs ~660 px for the grid, and the panel
    // keeps 24 px of padding on each side. The minimum matches, so the grid can
    // never be squeezed into scrolling.
    .inner_size(820.0, 700.0)
    .min_inner_size(720.0, 520.0)
    // Not resizable: Windows keeps a sizing frame on a borderless window that can
    // be resized, and on a transparent one that frame paints as a thin outline
    // around the whole window — the "transparent margin with an obvious edge"
    // report. The pet window avoids it the same way, and the panel is already
    // sized for the widest thing in it (the 53-week click heatmap).
    .resizable(false)
    // Transparent so the "liquid glass" card in lite-settings.css can let the
    // desktop tint it, and so its rounded corners are really rounded instead of
    // sitting on an opaque rectangle. macOS needs app.macOSPrivateApi for this,
    // which tauri.conf.json already sets.
    .transparent(true)
    // No native frame shadow. Windows draws it around the *window*, so on a
    // transparent window it shows up as a rectangular halo in the margin around
    // the card — the pet window turns it off for the same reason, and the card
    // carries its own shadow instead.
    .shadow(false)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    // The page is not listening yet while the window is being built, so the
    // request waits for the renderer to announce itself instead of racing it.
    if let Some(section) = section {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(700));
            if let Some(panel) = handle.get_webview_window("settings") {
                let _ = panel.emit("settings-focus-section", section);
            }
        });
    }
    let _ = window;
    Ok(())
}

/// Whether Prismoo is registered to start with the OS session.
#[tauri::command]
pub fn autolaunch_get(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Enable / disable auto-launch and report the resulting state.
#[tauri::command]
pub fn autolaunch_set(app: AppHandle, enabled: bool) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let _ = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    manager.is_enabled().unwrap_or(enabled)
}
