use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::TypeTextParams;
use serde_json::json;

use crate::request::Op;
use crate::test_support::harness;

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
