//! Keep an enabled login-start preference when the product name changes.

#[cfg(not(debug_assertions))]
use tauri_plugin_autostart::ManagerExt;

// Only remove the previous entry after the replacement was successfully written.
// A disabled preference must never be turned on by a brand change.
#[cfg(any(not(debug_assertions), test))]
fn transfer_enabled(
    enabled: bool,
    enable_new: impl FnOnce() -> Result<(), String>,
    disable_old: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if enabled {
        enable_new()?;
        disable_old()?;
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
pub fn migrate<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let executable = executable.display().to_string();
    let mut builder = auto_launch::AutoLaunchBuilder::new();
    // This is the old productName, which the plugin used as its registration key.
    builder.set_app_name("Prismoo");
    builder.set_app_path(&executable);
    builder.set_args(&["--autostart"]);
    #[cfg(target_os = "macos")]
    builder.set_use_launch_agent(true);
    let legacy = builder.build().map_err(|e| e.to_string())?;
    let enabled = legacy.is_enabled().map_err(|e| e.to_string())?;
    transfer_enabled(
        enabled,
        || app.autolaunch().enable().map_err(|e| e.to_string()),
        || legacy.disable().map_err(|e| e.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::transfer_enabled;
    use std::cell::RefCell;

    #[test]
    fn enabled_preference_creates_replacement_before_removing_old_entry() {
        let calls = RefCell::new(Vec::new());
        transfer_enabled(
            true,
            || {
                calls.borrow_mut().push("enable");
                Ok(())
            },
            || {
                calls.borrow_mut().push("disable");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), vec!["enable", "disable"]);
    }

    #[test]
    fn disabled_preference_is_left_disabled() {
        transfer_enabled(
            false,
            || panic!("must not enable startup"),
            || panic!("must not change a disabled legacy entry"),
        )
        .unwrap();
    }

    #[test]
    fn failed_replacement_keeps_existing_startup_entry() {
        let result = transfer_enabled(
            true,
            || Err("write failed".into()),
            || panic!("must retain the working startup entry"),
        );
        assert_eq!(result, Err("write failed".into()));
    }
}
