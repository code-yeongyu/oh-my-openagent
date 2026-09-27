use serde_json::{json, Value};

use super::*;

#[test]
fn unavailable_capabilities_serialize_the_frozen_camel_case_field_set() {
    // When
    let value = serde_json::to_value(DesktopCapabilities::unavailable()).unwrap();
    // Then
    let Value::Object(fields) = value else {
        panic!("capabilities must serialize to an object")
    };
    let keys: Vec<&str> = fields.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "backend",
            "displayServer",
            "capture",
            "input",
            "ax",
            "backgroundWindowInput",
            "deliveryModes",
            "capturePermission",
            "inputPermission",
            "axPermission",
            "displayCount",
            "focusGuard",
            "stopPath",
            "stopReason",
            "integrityLevel",
            "screenLocked",
        ]
    );
}

#[test]
fn ax_node_reference_is_named_ref_on_the_wire() {
    // Given
    let node = AxNode {
        ref_: "e1".into(),
        role: "button".into(),
        native_role: "AXButton".into(),
        title: None,
        value: None,
        description: None,
        enabled: true,
        focused: false,
        x: None,
        y: None,
        width: None,
        height: None,
        actions: None,
        child_count: 0,
    };
    // When
    let value = serde_json::to_value(node).unwrap();
    // Then
    assert_eq!(
        (&value["ref"], &value["nativeRole"]),
        (&json!("e1"), &json!("AXButton"))
    );
}

#[test]
fn capture_modes_use_kebab_case_wire_names() {
    let modes = [
        CaptureMode::InlinePng,
        CaptureMode::InlineJpeg,
        CaptureMode::ArtifactOnly,
    ];
    assert_eq!(
        serde_json::to_value(modes).unwrap(),
        json!(["inline-png", "inline-jpeg", "artifact-only"])
    );
}

#[test]
fn session_options_missing_fields_take_documented_defaults() {
    // When: the host sends only two fields.
    let options: DesktopSessionOptions =
        serde_json::from_value(json!({"allowHostRelayOnlyStop": true, "captureCaps": {"maxWidth": 1280}}))
            .unwrap();
    // Then
    assert!(options.allow_host_relay_only_stop);
    assert_eq!(options.capture_caps.max_width, Some(1280));
    assert_eq!(options.capture_caps.max_bytes, DEFAULT_CAPTURE_MAX_BYTES);
    assert_eq!(options.screenshot_gc, ScreenshotGc::default());
    assert_eq!((options.audit_path, options.artifact_dir), (None, None));
}
