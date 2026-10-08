// ============================================================================
// Config store — the Tauri counterpart of src/shared/config.ts.
//
// The config is kept as a JSON object rather than a mirrored Rust struct: the
// renderer already owns the schema (src/shared/types.ts), so treating it as a
// patchable document avoids two definitions drifting apart.
// ============================================================================

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct ConfigState {
    path: PathBuf,
    value: Mutex<Value>,
}

/// Mirrors DEFAULT_CONFIG in src/shared/config.ts.
pub fn defaults() -> Value {
    json!({
        "skin": "bulu",
        "currentPetId": "bulu",
        "animSpeed": 1,
        "opacity": 1,
        "autoLaunch": false,
        "aiEnabled": false,
        "apiKey": "",
        "apiBaseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "aiProviders": [],
        "aiProviderId": "",
        "chatMaxTokens": 120,
        "chatTemperature": 0.8,
        "chatVerbosity": "normal",
        "chatEmoji": false,
        "chatUsageDate": "",
        "chatUsageMessages": 0,
        "chatUsageTokens": 0,
        "soundEnabled": true,
        "customImageMode": "single",
        "customImagePath": "",
        "customImageRevision": 0,
        "cutoutTolerance": 25,
        // Trace the imported picture with a white silhouette. A cutout that is not
        // pixel-perfect reads as ragged on a busy desktop; the outline makes the
        // edge look deliberate. Off by default — Bulu needs no help.
        "customOutline": false,
        "locale": "zh",
        "theme": "light",
        // The wardrobe's saved equipment: slot -> accessory id (see
        // src/shared/accessory-types.ts). Older config files simply do not have
        // it; `fill_missing` adds the empty object and the manager reads that as
        // "nothing equipped".
        "equippedAccessories": {},
        "accessoryDebug": false,
        // Pet needs (0..100) read by behavior conditions. Older config files do
        // not have this key; the defaults below are a content pet.
        "petStats": { "mood": 70, "energy": 80, "hunger": 20 },
        "animDebug": false,
        "actionAutoIdle": true,
        "actionDebug": false,
        "affinity": 0,
        "focusMode": true,
        "focusInterval": 40,
        "statsFirstSeen": "",
        "statsDays": [],
        "statsClicks": 0,
        "statsChats": 0,
        "affinityHistory": [],
        "greetEnabled": true,
        "weatherEnabled": true,
        "hourlyChime": true,
        "photoEyes": null,
        "autoMove": true,
        "fileDropReactions": true,
        "standReminderEnabled": true,
        "standReminderMinutes": 5,
        // Health plan. The two new items start off: the standing reminder is
        // already on by default, and stacking two more timers on a fresh install
        // would turn the pet into a metronome. They are one click away in
        // Settings → 健康计划.
        "eyeRestEnabled": false,
        "eyeRestMinutes": 20,
        "waterEnabled": false,
        "waterMinutes": 45,
        // Per local-day counters: { "YYYY-MM-DD": { clicks, stand, eye, water } }.
        // Written by the pet window (batched, see `flushDailyStats`) and read by
        // the settings panel's click heatmap. Pruned to the last ~400 days.
        "dailyStats": {},
        // Reminders the user left for the pet: [{ id, text, at }], `at` being the
        // ms epoch to announce at. Small enough to live in this file, and it has
        // to survive a restart, so there is no separate store.
        "reminders": [],
        // Whether the pet reacts to CPU / memory / battery (src-tauri/src/load.rs).
        "loadAwareness": true,
        "petScale": 1,
        "stayOnOneDisplay": true,
        "snapToEdge": false,
        "sleepTimeoutSec": 30,
        "wanderSpeed": 1,
        "activityFrequency": 1,
        "updateAutoCheck": true,
        "updateAutoDownload": true,
        "updateChannel": "stable",
        "updateDeferredVersion": "",
        "updateDeferredAt": 0,
        "updateNextAutoCheckAt": 0,
        "updateAutoRetry": 0
    })
}

/// Keys a patch must REPLACE rather than deep-merge.
///
/// `equippedAccessories` is a slot → accessory-id map. Taking a hat off removes
/// the `head` key, and a recursive merge would simply keep the old id — the hat
/// would come back on the next launch, and a config naming a deleted accessory
/// could never be cleaned up from the UI. Everything else keeps the documented
/// merge semantics (a patch touching one AI field must not wipe the rest).
const REPLACE_ON_PATCH: [&str; 1] = ["equippedAccessories"];

/// Recursively merge `patch` into `base` (objects merge, everything else replaces).
fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (key, patch_value) in patch_map {
                if REPLACE_ON_PATCH.contains(&key.as_str()) {
                    base_map.insert(key.clone(), patch_value.clone());
                    continue;
                }
                deep_merge(base_map.entry(key.clone()).or_insert(Value::Null), patch_value);
            }
        }
        (base_slot, patch_value) => *base_slot = patch_value.clone(),
    }
}

/// Recursively copy in keys the stored config does not have yet.
///
/// This must NOT be `deep_merge`: merging the defaults with the overwrite semantics
/// used for patches resets every stored value back to its default on startup — which
/// is exactly what happened before (the chosen pet, theme, size and so on were lost
/// on every relaunch).
fn fill_missing(base: &mut Value, defaults: &Value) {
    let (Value::Object(base_map), Value::Object(default_map)) = (base, defaults) else {
        return;
    };
    for (key, default_value) in default_map {
        match base_map.get_mut(key) {
            Some(existing) => fill_missing(existing, default_value),
            None => {
                base_map.insert(key.clone(), default_value.clone());
            }
        }
    }
}

pub fn init(app: &AppHandle) -> ConfigState {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("config.json");

    let mut value = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| Value::Object(Map::new()));
    // Existing users chose a skin before PetPack existed; preserve that selection.
    if value.get("currentPetId").is_none() {
        if let Some(skin) = value.get("skin").and_then(Value::as_str).map(str::to_string) {
            value["currentPetId"] = Value::String(skin);
        }
    }
    migrate_retired_skin(&mut value);
    // Fill in anything the persisted file is missing (new keys, first run).
    fill_missing(&mut value, &defaults());
    seed_provider_from_legacy(&mut value);

    ConfigState {
        path,
        value: Mutex::new(value),
    }
}

/// Map a skin from an older install onto the character that still ships.
///
/// Bulu is the only built-in pet now, so a config that still says `cat` / `dog` /
/// `default` / `robot` would point the pet window at art that is no longer in the
/// bundle. Imported pictures (`custom`) and Bulu itself are left alone.
fn migrate_retired_skin(value: &mut Value) {
    if matches!(
        value.get("skin").and_then(Value::as_str),
        Some("cat" | "dog" | "default" | "robot")
    ) {
        value["skin"] = Value::String("bulu".to_string());
        value["currentPetId"] = Value::String("bulu".to_string());
    }
}

/// Best-effort display label derived from a base URL host.
fn provider_label(base_url: &str) -> String {
    let host = base_url
        .split("://")
        .nth(1)
        .unwrap_or(base_url)
        .split('/')
        .next()
        .unwrap_or("");
    if host.contains("openai") {
        "OpenAI".to_string()
    } else if host.contains("deepseek") {
        "DeepSeek".to_string()
    } else if host.contains("moonshot") {
        "Moonshot".to_string()
    } else if host.contains("localhost") || host.starts_with("127.") {
        "Local".to_string()
    } else if host.is_empty() {
        "Default".to_string()
    } else {
        host.to_string()
    }
}

/// Turn the single legacy base URL / key / model into the first saved provider, so
/// the new provider switcher starts populated instead of empty on upgrade.
fn seed_provider_from_legacy(value: &mut Value) {
    let providers_empty = value
        .get("aiProviders")
        .and_then(|v| v.as_array())
        .map(|list| list.is_empty())
        .unwrap_or(true);
    if !providers_empty {
        return;
    }

    let base_url = value
        .get("apiBaseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = value
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = value
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if base_url.is_empty() && api_key.is_empty() {
        return;
    }

    let provider = json!({
        "id": "default",
        "name": provider_label(&base_url),
        "baseUrl": base_url,
        "apiKey": api_key,
        "model": model,
    });
    if let Some(map) = value.as_object_mut() {
        map.insert("aiProviders".into(), json!([provider]));
        map.insert("aiProviderId".into(), json!("default"));
    }
}

impl ConfigState {
    pub fn snapshot(&self) -> Value {
        self.value.lock().unwrap().clone()
    }

    /// Apply a partial patch and return the merged document.
    pub fn apply(&self, patch: &Value) -> Value {
        let mut value = self.value.lock().unwrap();
        deep_merge(&mut value, patch);
        value.clone()
    }

    pub fn get(&self, key: &str) -> Value {
        self.value
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn persist(&self) {
        let value = self.snapshot();
        if let Ok(raw) = serde_json::to_string_pretty(&value) {
            let _ = fs::write(&self.path, raw);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Regression: merging the defaults into a stored config must not reset the
    /// values the user already chose (that bug wiped every setting on relaunch).
    #[test]
    fn defaults_fill_gaps_without_overwriting() {
        let mut stored = json!({ "skin": "bulu", "petScale": 1.25, "theme": "dark" });
        fill_missing(&mut stored, &defaults());

        assert_eq!(stored.get("skin").and_then(|v| v.as_str()), Some("bulu"));
        assert_eq!(stored.get("petScale").and_then(|v| v.as_f64()), Some(1.25));
        assert_eq!(stored.get("theme").and_then(|v| v.as_str()), Some("dark"));
        // …while keys the file does not have yet still get their default.
        assert_eq!(
            stored.get("chatMaxTokens").and_then(|v| v.as_i64()),
            Some(120)
        );
    }

    /// Patches (config_set) keep the overwrite semantics.
    #[test]
    fn deep_merge_overwrites_for_patches() {
        let mut stored = json!({ "skin": "bulu", "focusInterval": 40 });
        deep_merge(&mut stored, &json!({ "skin": "cat" }));
        assert_eq!(stored.get("skin").and_then(|v| v.as_str()), Some("cat"));
        assert_eq!(stored.get("focusInterval").and_then(|v| v.as_i64()), Some(40));
    }

    /// Regression: removing a key from the equipment map has to stick, or an
    /// unequipped hat reappears on the next launch.
    #[test]
    fn deep_merge_replaces_the_equipment_map() {
        let mut stored = json!({ "equippedAccessories": { "head": "cowboy_hat", "neck": "red_scarf" } });
        deep_merge(&mut stored, &json!({ "equippedAccessories": { "neck": "red_scarf" } }));
        let gear = stored.get("equippedAccessories").unwrap();
        assert!(gear.get("head").is_none(), "unequipping must remove the slot key");
        assert_eq!(gear.get("neck").and_then(|v| v.as_str()), Some("red_scarf"));

        deep_merge(&mut stored, &json!({ "equippedAccessories": {} }));
        assert_eq!(
            stored.get("equippedAccessories").unwrap().as_object().unwrap().len(),
            0
        );
    }

    /// Everything else still merges, so a one-field patch cannot wipe a section.
    #[test]
    fn deep_merge_still_merges_nested_objects() {
        let mut stored = json!({ "update": { "a": 1, "b": 2 } });
        deep_merge(&mut stored, &json!({ "update": { "a": 9 } }));
        assert_eq!(stored["update"]["a"], 9);
        assert_eq!(stored["update"]["b"], 2);
    }

    /// An install from before the line-up was trimmed has to come back as Bulu —
    /// otherwise the pet window asks for art that is no longer in the bundle.
    #[test]
    fn retired_skins_migrate_to_bulu() {
        for retired in ["cat", "dog", "default", "robot"] {
            let mut stored = json!({ "skin": retired, "currentPetId": retired });
            migrate_retired_skin(&mut stored);
            assert_eq!(stored["skin"], "bulu", "{retired} should migrate");
            assert_eq!(stored["currentPetId"], "bulu", "{retired} should migrate");
        }
        // The two skins that still exist are left exactly as they are.
        for kept in ["bulu", "custom"] {
            let mut stored = json!({ "skin": kept, "currentPetId": kept });
            migrate_retired_skin(&mut stored);
            assert_eq!(stored["skin"], kept);
            assert_eq!(stored["currentPetId"], kept);
        }
    }
}
