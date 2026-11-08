use std::cell::Cell;

use senpi_desktop_backend_fake::FakeMethod;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{AxSnapshotParams, ObserveParams};
use senpi_desktop_core::types::{CaptureCaps, ObserveResult, Target};
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

fn params() -> ObserveParams {
    ObserveParams {
        target: "101".into(),
        caps: Some(CaptureCaps {
            max_width: Some(32),
            ..CaptureCaps::default()
        }),
        ax: None,
    }
}

fn observe(h: &mut Harness) -> ObserveResult {
    match h.process(Op::Observe(params())).unwrap() {
        Response::Observe(result) => result,
        other => panic!("expected observation: {other:?}"),
    }
}

fn refs(text: &str) -> Vec<String> {
    text.split("[ref=")
        .skip(1)
        .map(|rest| rest.split(']').next().unwrap().to_owned())
        .collect()
}

fn snapshot(h: &mut Harness) -> Vec<String> {
    match h.process(Op::AxSnapshot(AxSnapshotParams {
        target: "101".into(),
        opts: None,
    })).unwrap() {
        Response::Snapshot(snapshot) => refs(&snapshot.text),
        other => panic!("expected snapshot: {other:?}"),
    }
}

#[test]
fn failed_observation_rolls_back_frame_and_both_delivered_ax_generations() {
    // Given: a full frame and two delivered AX generations.
    let mut h = harness(&json!({}));
    let id = h.capture("101");
    let target = Target::parse("101");
    let frame = h.worker.frames.latest(&target, Some(&id)).unwrap();
    let previous = snapshot(&mut h);
    let current = snapshot(&mut h);
    h.faults.fail_next(FakeMethod::AxWindowRoot, ErrorCode::AxFailed);
    // When
    let error = h.process(Op::Observe(params())).unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert_eq!(h.worker.frames.latest_id("101"), Some(id.as_str()));
    assert_eq!(h.worker.frames.latest(&target, Some(&id)).unwrap(), frame);
    for reference in previous.iter().chain(&current) {
        assert!(h.worker.registry.resolve(reference).is_ok());
    }
    let retry = observe(&mut h);
    assert_ne!(retry.capture.frame_id, id);
    assert_eq!(h.worker.frames.latest_id("101"), Some(retry.capture.frame_id.as_str()));
    assert_ne!(h.worker.frames.latest(&target, None).unwrap(), frame);
    assert_eq!(retry.capture.coordinate_width, 32);
    assert!(retry.node_count > 0);
    for reference in refs(&retry.ax).iter().chain(&current) {
        assert!(h.worker.registry.resolve(reference).is_ok());
    }
    for reference in previous {
        assert_eq!(h.worker.registry.resolve(&reference).err().unwrap().code, ErrorCode::StaleRef);
    }
}

#[test]
fn cancellation_between_capture_and_ax_preserves_frame_and_skips_ax() {
    // Given
    let mut h = harness(&json!({}));
    let id = h.capture("101");
    let old_refs = snapshot(&mut h);
    h.faults.fail_next(FakeMethod::AxWindowRoot, ErrorCode::AxFailed);
    let checks = Cell::new(0);
    // When: the waiter abandons immediately after capture.
    let error = h.worker.process(Op::Observe(params()), &|| {
        checks.set(checks.get() + 1);
        checks.get() == 2
    }).unwrap_err();
    // Then: AX's queued fault remains for the next observation.
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(h.worker.frames.latest_id("101"), Some(id.as_str()));
    for reference in old_refs {
        assert!(h.worker.registry.resolve(&reference).is_ok());
    }
    assert_eq!(h.process(Op::Observe(params())).unwrap_err().code, ErrorCode::AxFailed);
}

#[test]
fn cancellation_after_ax_discards_unpublished_refs_and_preserves_frame() {
    // Given
    let mut h = harness(&json!({}));
    let id = h.capture("101");
    let previous = snapshot(&mut h);
    let current = snapshot(&mut h);
    let checks = Cell::new(0);
    // When: cancellation lands during accessibility.
    let error = h.worker.process(Op::Observe(params()), &|| {
        checks.set(checks.get() + 1);
        checks.get() == 3
    }).unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(h.worker.frames.latest_id("101"), Some(id.as_str()));
    for reference in previous.iter().chain(&current) {
        assert!(h.worker.registry.resolve(reference).is_ok());
    }
    let next = current.last().unwrap().strip_prefix('e').unwrap().parse::<u64>().unwrap() + 1;
    assert!(h.worker.registry.resolve(&format!("e{next}")).is_err());
    let retry = observe(&mut h);
    assert_ne!(retry.capture.frame_id, id);
    for reference in refs(&retry.ax) {
        assert!(h.worker.registry.resolve(&reference).is_ok());
    }
}

#[test]
fn abandoned_observation_reply_never_commits_frame_or_ax_refs() {
    // Given
    let mut h = harness(&json!({}));
    let id = h.capture("101");
    let frame = h.worker.frames.latest(&Target::parse("101"), Some(&id)).unwrap();
    let previous = snapshot(&mut h);
    let current = snapshot(&mut h);
    let (reply, receiver) = flume::bounded(1);
    let unpublished = Cell::new(Vec::new());
    // When: receiver disappears after execution, at the real send boundary.
    h.worker.dispatch(Op::Observe(params()), &|| false, |result| {
        let Response::Observe(observed) = result.as_ref().unwrap() else {
            panic!("expected observation");
        };
        unpublished.set(refs(&observed.ax));
        drop(receiver);
        reply.send(result).is_ok()
    });
    // Then
    assert_eq!(h.worker.frames.latest_id("101"), Some(id.as_str()));
    assert_eq!(h.worker.frames.latest(&Target::parse("101"), Some(&id)).unwrap(), frame);
    for reference in previous.iter().chain(&current) {
        assert!(h.worker.registry.resolve(reference).is_ok());
    }
    let discarded = unpublished.take();
    assert!(!discarded.is_empty());
    for reference in &discarded {
        assert!(h.worker.registry.resolve(reference).is_err());
    }
    let retry = observe(&mut h);
    assert_ne!(retry.capture.frame_id, id);
    assert!(refs(&retry.ax).iter().all(|reference| !discarded.contains(reference)));
}

#[test]
fn observation_refuses_non_window_targets() {
    let mut h = harness(&json!({}));
    for target in ["desktop", "display:1"] {
        let error = h.process(Op::Observe(ObserveParams {
            target: target.into(),
            ..params()
        })).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidTarget);
    }
}

#[test]
fn delivered_observation_commits_matching_frame_and_live_ax_refs() {
    let mut h = harness(&json!({}));
    let previous = h.capture("101");
    let (reply, receiver) = flume::bounded(1);
    h.worker.dispatch(Op::Observe(params()), &|| false, |result| reply.send(result).is_ok());
    let Response::Observe(result) = receiver.recv().unwrap().unwrap() else {
        panic!("expected observation");
    };
    assert_ne!(result.capture.frame_id, previous);
    assert_eq!(h.worker.frames.latest_id("101"), Some(result.capture.frame_id.as_str()));
    assert!(h.worker.frames.latest(&Target::parse("101"), Some(&previous)).is_err());
    for reference in refs(&result.ax) {
        assert!(h.worker.registry.resolve(&reference).is_ok());
        assert_eq!(h.worker.registry.target(&reference).unwrap(), "101");
    }
}
