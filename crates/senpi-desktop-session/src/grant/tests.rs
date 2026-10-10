use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_results::ControlStateResult;
use senpi_desktop_safety::{StopPathId, StopSource};
use serde_json::json;

use crate::request::{Op, Response};
use std::sync::Arc;

use crate::test_support::{grant_control, harness, harness_with_slot, two_windows, Harness};

fn grant(harness: &mut Harness, reason: &str) -> Response {
    harness
        .process(grant_control(reason))
        .unwrap_or_else(|error| panic!("grant failed: {error}"))
}

fn state(harness: &mut Harness) -> ControlStateResult {
    match harness.process(Op::ControlState) {
        Ok(Response::ControlState(state)) => state,
        other => panic!("control.state failed: {other:?}"),
    }
}

#[test]
fn grant_reports_the_live_grant_and_revoke_is_idempotent() {
    // Given
    let mut harness = harness(&json!({}));
    // When
    let granted = grant(&mut harness, "click the install button");
    // Then
    let Response::ControlState(reply) = granted else {
        panic!("grant answered {granted:?}")
    };
    assert!(reply.active);
    assert_eq!(reply.reason.as_deref(), Some("click the install button"));
    let granted_at = reply.granted_at.expect("a grant carries grantedAt");
    assert_eq!(state(&mut harness).granted_at.as_deref(), Some(granted_at.as_str()));
    // When: revoked twice
    assert_eq!(harness.process(Op::ControlRevoke), Ok(Response::Unit));
    let second = harness.process(Op::ControlRevoke);
    // Then: idempotent, and the state is inactive
    assert_eq!(second, Ok(Response::Unit));
    assert_eq!(
        state(&mut harness),
        ControlStateResult {
            active: false,
            reason: None,
            granted_at: None,
        }
    );
}

#[test]
fn a_second_sessions_grant_is_refused_and_the_first_keeps_its_grant() {
    // Given: two sessions sharing one slot; the first holds the grant.
    let slot = crate::grant::ControlSlot::new();
    let mut first = harness_with_slot(&json!({}), Arc::clone(&slot));
    let mut second = harness_with_slot(&json!({}), slot);
    grant(&mut first, "first");
    // When
    let refused = second.process(grant_control("second"));
    // Then
    assert_eq!(refused.map_err(|error| error.code), Err(ErrorCode::InputBusy));
    assert!(state(&mut first).active);
    assert_eq!(
        second
            .audits()
            .iter()
            .map(|audit| (audit.action, audit.code))
            .collect::<Vec<_>>(),
        [(Method::ControlGrant, Some(ErrorCode::InputBusy))]
    );
}

#[test]
fn a_suspension_revokes_and_resume_never_restores_the_grant() {
    // Given
    let mut harness = harness(&json!({}));
    grant(&mut harness, "with the human watching");
    // When: a stop lands and the user resumes
    harness.supervisor.trigger_stop(StopSource::Hotkey);
    harness.supervisor.reset_for_test();
    harness.supervisor.set_live(StopPathId::Global, true);
    // Then: the next request reconciles the grant away
    assert_eq!(
        state(&mut harness),
        ControlStateResult {
            active: false,
            reason: None,
            granted_at: None,
        }
    );
}

#[test]
fn re_grant_by_the_same_session_replaces_the_generation() {
    // Given
    let mut harness = harness(&json!({}));
    grant(&mut harness, "one");
    let first_generation = harness.queue_generation();
    // When
    let second = grant(&mut harness, "two");
    // Then: a fresh generation (timestamps can share a millisecond)
    let Response::ControlState(two) = second else {
        unreachable!()
    };
    assert!(first_generation.is_some());
    assert_ne!(harness.queue_generation(), first_generation);
    assert_eq!(two.reason.as_deref(), Some("two"));
}

#[test]
fn grant_and_revoke_each_emit_exactly_one_audit_with_the_reason_hashed() {
    // Given
    let mut harness = harness(&two_windows());
    // When
    grant(&mut harness, "abc");
    harness.process(Op::ControlRevoke).expect("revokes");
    // Then: exactly one event each; SHA-256("abc") starts ba7816bf8f01cfea.
    let audits = harness.audits();
    assert_eq!(audits.len(), 2, "{audits:?}");
    let grant_audit = &audits[0];
    assert_eq!(
        (
            grant_audit.action,
            grant_audit.code,
            grant_audit.text_length,
            grant_audit.text_sha256.as_deref()
        ),
        (Method::ControlGrant, None, Some(3), Some("ba7816bf8f01cfea"))
    );
    let revoke_audit = &audits[1];
    assert_eq!(
        (
            revoke_audit.action,
            revoke_audit.code,
            revoke_audit.text_sha256.as_deref()
        ),
        (Method::ControlRevoke, None, None)
    );
    // The raw reason never appears in the serialized events.
    let serialized = serde_json::to_string(&audits).expect("audits serialize");
    assert!(!serialized.contains("abc"), "{serialized}");
}

#[test]
fn close_releases_the_slot_for_the_next_session() {
    // Given
    let mut first = harness(&json!({}));
    grant(&mut first, "first");
    // When
    drop(first);
    // Then: a new session can be granted
    let mut second = harness(&json!({}));
    grant(&mut second, "second");
    assert!(state(&mut second).active);
}
