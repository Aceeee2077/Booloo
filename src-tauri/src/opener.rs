// ============================================================================
// "Open the project page" — the GitHub button in the settings title bar.
//
// The renderer cannot do this on its own: a Tauri webview has no `window.open`,
// and letting the page name the URL would turn one command into a way to launch
// arbitrary links. The address is a constant here and the command takes no
// arguments at all.
//
// No plugin is pulled in for it: `tauri-plugin-opener` would add a dependency
// (and a network fetch at build time) for one call the platform already
// exports — shell32 on Windows, `open` on macOS, `xdg-open` elsewhere.
// ============================================================================

/// The project's public repository.
const PROJECT_URL: &str = "https://github.com/Aceeee2077/Prismoo";

#[cfg(target_os = "windows")]
fn launch(url: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut core::ffi::c_void;
    }

    const SW_SHOWNORMAL: i32 = 1;

    let wide = |text: &str| -> Vec<u16> {
        OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
    };
    let operation = wide("open");
    let target = wide(url);
    // SAFETY: both strings are NUL-terminated and outlive the call; the handle
    // is null because the launcher does not need an owner window.
    let opened = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW documents "greater than 32" as success — the small values are
    // error codes, not pointers.
    if opened as isize <= 32 {
        return Err("the default browser could not be launched".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_project_page() -> Result<(), String> {
    launch(PROJECT_URL)
}

#[cfg(test)]
mod tests {
    use super::PROJECT_URL;

    #[test]
    fn the_button_points_at_this_repository() {
        assert_eq!(PROJECT_URL, "https://github.com/Aceeee2077/Prismoo");
        // The renderer never supplies the address, so an https prefix here is the
        // whole security story of this command.
        assert!(PROJECT_URL.starts_with("https://"));
    }
}
