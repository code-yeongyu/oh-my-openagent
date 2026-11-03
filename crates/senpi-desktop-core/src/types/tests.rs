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
            "cursorOverlay",
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
fn the_intervention_watch_is_reported_as_on_off_or_not_started_only_when_a_backend_has_one() {
    for (watch, wire) in [
        (InterventionWatch::On, "on"),
        (InterventionWatch::Off, "off"),
        (InterventionWatch::NotStarted, "not_started"),
    ] {
        // Given
        let capabilities = DesktopCapabilities {
            intervention_watch: Some(watch),
            ..DesktopCapabilities::unavailable()
        };
        // When
        let value = serde_json::to_value(&capabilities).unwrap();
        // Then
        assert_eq!(value["interventionWatch"], json!(wire));
        let parsed: DesktopCapabilities = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.intervention_watch, Some(watch));
    }
    let absent = serde_json::to_value(DesktopCapabilities::unavailable()).unwrap();
    assert!(absent.get("interventionWatch").is_none());
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
    assert!(options.show_cursor);
    assert_eq!(options.screenshot_gc, ScreenshotGc::default());
    assert_eq!((options.audit_path, options.artifact_dir), (None, None));
}

#[test]
fn session_options_preserve_explicit_cursor_off() {
    let options: DesktopSessionOptions =
        serde_json::from_value(json!({"showCursor": false})).unwrap();
    assert!(!options.show_cursor);
}

#[test]
fn session_options_preserve_explicit_canary_policy() {
    // Given
    let options: DesktopSessionOptions =
        serde_json::from_value(json!({"macosCanary": "off"})).unwrap();
    // When
    let value = serde_json::to_value(options).unwrap();
    // Then
    assert_eq!(value["macosCanary"], "off");
}

#[test]
fn session_options_default_to_session_canary() {
    // Given
    let options: DesktopSessionOptions = serde_json::from_value(json!({})).unwrap();
    // When
    let value = serde_json::to_value(options).unwrap();
    // Then
    assert_eq!(value["macosCanary"], "session");
}

#[test]
fn session_options_reject_unknown_canary_policy() {
    // When
    let result = serde_json::from_value::<DesktopSessionOptions>(json!({"macosCanary": "always"}));
    // Then
    assert!(result.is_err());
}
