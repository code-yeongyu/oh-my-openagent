//! Acceptance 88: the listing records, and every reply that can carry screen-derived
//! text, require `observation.untrustedText:true`; wire validation rejects them without it.

use serde_json::{json, Value};

use crate::listing::{AppInfo, ElementInfo, Surface, WindowInfo};
use crate::schema::engine_schema;

const SIGNED: &[&str] = &[
    "WindowInfo",
    "ElementInfo",
    "AppInfo",
    "Surface",
    "Frame",
    "Observation",
    "ClipboardContent",
    "MenuItems",
    "Diagnosis",
];

fn window() -> Value {
    json!({
        "id": "101", "identity": {"pid": 4242, "processStart": 7}, "app": "Notes", "appKey": "com.example.notes",
        "title": "Untitled", "bounds": {"x": 0.0, "y": 0.0, "width": 800.0, "height": 600.0}, "display": "1",
        "focused": false, "isOnScreen": false, "minimized": true, "elevated": false, "z": 2,
        "observation": {"untrustedText": true}
    })
}

fn element() -> Value {
    json!({"ref": "s1:e2", "role": "button", "label": "Save", "window": "101", "generation": 1, "observation": {"untrustedText": true}})
}

fn app() -> Value {
    json!({"appKey": "com.example.notes", "name": "Notes", "running": true, "source": "running", "observation": {"untrustedText": true}})
}

fn surface() -> Value {
    json!({"kind": "system_tray", "id": "tray", "observation": {"untrustedText": true}})
}

fn parses(kind: &str, value: Value) -> bool {
    match kind {
        "WindowInfo" => serde_json::from_value::<WindowInfo>(value).is_ok(),
        "ElementInfo" => serde_json::from_value::<ElementInfo>(value).is_ok(),
        "AppInfo" => serde_json::from_value::<AppInfo>(value).is_ok(),
        _ => serde_json::from_value::<Surface>(value).is_ok(),
    }
}

#[test]
fn listing_records_carry_untrusted_text() {
    let schema = engine_schema();
    for name in SIGNED {
        let definition = &schema["$defs"][*name];
        assert_eq!(
            definition["properties"]["observation"]["$ref"], "#/$defs/UntrustedText",
            "{name} lacks the signal"
        );
        let required = definition["required"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert!(
            required.contains(&json!("observation")),
            "{name} must require observation"
        );
    }
    assert_eq!(
        schema["$defs"]["UntrustedText"]["properties"]["untrustedText"],
        json!({"const": true})
    );
    for (kind, record) in [
        ("WindowInfo", window()),
        ("ElementInfo", element()),
        ("AppInfo", app()),
        ("Surface", surface()),
    ] {
        assert!(parses(kind, record.clone()), "{kind} sample must parse");
        let mut without = record.clone();
        without
            .as_object_mut()
            .map(|object| object.remove("observation"));
        assert!(
            !parses(kind, without),
            "{kind} without the signal must be rejected"
        );
        let mut negated = record.clone();
        negated["observation"] = json!({"untrustedText": false});
        assert!(
            !parses(kind, negated),
            "{kind} with untrustedText:false must be rejected"
        );
    }
    let listed: WindowInfo = serde_json::from_value(window()).expect("window");
    assert!(
        listed.minimized,
        "a minimized window is listed with minimized:true"
    );
    assert_eq!(
        serde_json::to_value(&listed).expect("serializes")["observation"],
        json!({"untrustedText": true})
    );
}

#[test]
fn capability_spellings_are_single() {
    let schema = engine_schema();
    assert_eq!(
        schema["$defs"]["CaptureRoute"]["enum"],
        json!([
            "composite",
            "root_crop",
            "screencast",
            "screencast_crop",
            "screenshot_portal"
        ])
    );
    assert_eq!(
        schema["$defs"]["Compositor"]["properties"]["sessionLockProtocol"]["type"],
        "boolean"
    );
    let text = schema.to_string();
    assert!(!text.contains("lockState"), "there is no lockState member");
    assert_eq!(
        text.matches("\"compositor\":").count(),
        1,
        "compositor is declared once"
    );
}
