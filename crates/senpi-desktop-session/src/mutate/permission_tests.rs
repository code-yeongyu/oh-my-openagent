use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::error::{ErrorCode, TccPermission};
use senpi_desktop_safety::{StopPathFailure, StopPathId};
use senpi_desktop_core::protocol_params::TypeTextParams;
use serde_json::json;

use crate::request::Op;
use crate::test_support::{click_window, harness};

fn type_hi() -> Op {
    Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "hi".to_owned(),
        opts: None,
    })
}

#[test]
fn prompt_or_granted_input_passes_the_gate() {
    // Given: a backend whose consent is asked on first input (Wayland portal).
    let mut harness = harness(&json!({ "capabilities": { "inputPermission": "prompt-or-granted" } }));
    // When
    let reply = harness.process(type_hi());
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert!(harness
        .sink
        .ops()
        .iter()
        .any(|op| matches!(op, SinkOp::TypeText { .. })));
}

#[test]
fn unavailable_input_is_refused_before_the_backend() {
    // Given
    let mut harness = harness(&json!({ "capabilities": { "inputPermission": "unavailable" } }));
    // When
    let reply = harness.process(type_hi());
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::PermissionDenied));
    assert!(!harness
        .sink
        .ops()
        .iter()
        .any(|op| matches!(op, SinkOp::TypeText { .. })));
}

#[test]
fn denied_global_listener_enriches_click_without_injecting_input() {
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    harness.supervisor.set_live(StopPathId::Global, false);
    harness.supervisor.note_global_failure(Some(StopPathFailure::AccessibilityDenied));
    harness.supervisor.set_live(StopPathId::HostRelay, true);

    let error = harness.process(click_window(&frame, None)).unwrap_err();

    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert_eq!(error.message, "backend-enriched permission refusal");
    let data = error.permission.unwrap();
    assert_eq!(data.permission, TccPermission::Accessibility);
    assert_eq!(data.app, "Marked fake launcher");
    assert!(data.relaunch_required);
    assert!(!harness.sink.ops().iter().any(|op| matches!(op, SinkOp::Pointer { .. })));
}

#[test]
fn ordinary_input_permission_refusal_is_also_backend_enriched() {
    let mut harness = harness(&json!({ "capabilities": { "inputPermission": "denied" } }));
    let frame = harness.capture("101");
    let error = harness.process(click_window(&frame, None)).unwrap_err();
    assert_eq!(error.message, "backend-enriched permission refusal");
    assert_eq!(error.permission.unwrap().permission, TccPermission::Accessibility);
    assert!(!harness.sink.ops().iter().any(|op| matches!(op, SinkOp::Pointer { .. })));
}
