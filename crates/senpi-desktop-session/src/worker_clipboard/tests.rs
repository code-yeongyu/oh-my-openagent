use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::ClipboardText;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::harness;

const SECRET: &str = "senpi-clipboard-secret";

fn write(text: &str) -> Op {
    Op::ClipboardWrite(ClipboardText { text: text.to_owned() })
}

fn clipboard_writes(ops: &[SinkOp]) -> usize {
    ops.iter().filter(|op| matches!(op, SinkOp::ClipboardWrite { .. })).count()
}

#[test]
fn a_written_text_reads_back() {
    // Given
    let mut harness = harness(&json!({}));
    harness.process(write(SECRET)).expect("writes");
    // When
    let read = harness.process(Op::ClipboardRead);
    // Then
    assert_eq!(
        read.expect("reads"),
        Response::Clipboard(ClipboardText { text: SECRET.to_owned() })
    );
}

#[test]
fn a_write_is_audited_by_length_and_digest_never_its_text() {
    // Given
    let mut harness = harness(&json!({}));
    // When
    harness.process(write("abc")).expect("writes");
    // Then: SHA-256("abc") starts ba7816bf8f01cfea.
    let audits = harness.audits();
    assert_eq!(audits.len(), 1);
    let audit = &audits[0];
    assert_eq!(
        (audit.target.as_str(), audit.text_length, audit.text_delivered, audit.text_sha256.as_deref()),
        ("desktop", Some(3), Some(3), Some("ba7816bf8f01cfea"))
    );
    let serialized = serde_json::to_string(audit).expect("audit serializes");
    assert!(!serialized.contains("abc\""), "{serialized}");
}

#[test]
fn reading_is_not_audited_and_passes_no_gate() {
    // Given: input suspended; reads are read-only requests.
    let mut harness = harness(&json!({}));
    harness.supervisor.trigger_stop(StopSource::Api);
    // When
    let read = harness.process(Op::ClipboardRead);
    // Then
    assert!(read.is_ok(), "{read:?}");
    assert!(harness.audits().is_empty());
}

#[test]
fn a_suspended_session_refuses_the_write_before_the_backend() {
    // Given
    let mut harness = harness(&json!({}));
    harness.supervisor.trigger_stop(StopSource::Api);
    // When
    let reply = harness.process(write(SECRET));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert_eq!(clipboard_writes(&harness.sink.ops()), 0);
    let codes: Vec<_> = harness.audits().iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::Suspended)]);
}

#[test]
fn denied_input_permission_refuses_the_write() {
    // Given
    let mut harness = harness(&json!({ "capabilities": { "inputPermission": "unavailable" } }));
    // When
    let reply = harness.process(write(SECRET));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::PermissionDenied));
    assert_eq!(clipboard_writes(&harness.sink.ops()), 0);
}
