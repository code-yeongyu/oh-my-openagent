//! In-flight typeText stops inside the one gated input transaction.

use std::sync::Arc;

use senpi_desktop_backend_fake::{RecordingSink, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::TypeTextParams;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::request::Op;
use crate::test_support::{harness, op_names};

fn posted_text(sink: &RecordingSink) -> String {
    sink.ops()
        .iter()
        .filter_map(|op| match op {
            SinkOp::TypeText { text, .. } => Some(text.as_str().to_owned()),
            _ => None,
        })
        .collect()
}

fn request(text: &str) -> Op {
    Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: text.to_owned(),
        opts: None,
    })
}

#[test]
fn type_text_stops_after_partial_delivery_and_releases_input() {
    // Given: the stop latches after eight characters have reached the fake.
    let mut harness = harness(&json!({}));
    let sink = harness.sink.clone();
    let supervisor = Arc::clone(&harness.supervisor);
    let text = "abcdefghijklmno";
    let probe = || {
        if posted_text(&sink).chars().count() >= 8 {
            supervisor.trigger_stop(StopSource::Hotkey);
        }
        false
    };
    // When
    let reply = harness.worker.process(request(text), &probe);
    // Then: only a prefix was delivered, and the same transaction released
    // input, handed key focus back and emitted exactly one truthful audit.
    let posted = posted_text(&harness.sink);
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert_eq!(posted, &text[..8]);
    assert_eq!(harness.audits().len(), 1);
    assert_eq!(harness.audits()[0].text_delivered, Some(8));
    assert_eq!(harness.audits()[0].text_length, Some(15));
    assert_eq!(
        op_names(&harness)
            .iter()
            .filter(|&&name| name == "release")
            .count(),
        1
    );
    assert_eq!(
        op_names(&harness)
            .iter()
            .filter(|&&name| name == "restore-key-focus")
            .count(),
        1
    );
}

#[test]
fn type_text_cancellation_preserves_unicode_scalars_and_releases_input() {
    // Given: the waiter cancels after the first eight Unicode scalars.
    let mut harness = harness(&json!({}));
    let sink = harness.sink.clone();
    let text = "한🙂éabcdefghi";
    let cancelled = || posted_text(&sink).chars().count() >= 8;
    // When
    let reply = harness.worker.process(request(text), &cancelled);
    // Then: the UTF-8 boundaries survive, while the audit counts scalars,
    // not bytes, even on the cancellation path.
    let posted = posted_text(&harness.sink);
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Cancelled));
    assert_eq!(posted, text.chars().take(8).collect::<String>());
    assert_eq!(harness.audits()[0].text_delivered, Some(8));
    assert_eq!(harness.audits()[0].text_length, Some(12));
    assert_eq!(
        op_names(&harness)
            .iter()
            .filter(|&&name| name == "release")
            .count(),
        1
    );
}
