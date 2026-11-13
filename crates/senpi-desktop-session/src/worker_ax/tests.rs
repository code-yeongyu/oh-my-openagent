use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{AxClickParams, AxElementAtParams, AxRefParams, AxSnapshotParams};
use senpi_desktop_core::types::{AxSnapshot, AxSnapshotOptions, Target};
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

fn window(id: &str, pid: u32, x: u32) -> Value {
    json!({"id": id, "title": id, "app": "App", "pid": pid, "x": x, "y": 120,
           "width": 800, "height": 600, "focused": false, "elevated": null})
}

fn overlapping_windows() -> Value {
    json!({"windows": [window("202", 8, 100), window("101", 4242, 100)]})
}

fn click(harness: &mut Harness, reference: String) -> Result<Response, ErrorCode> {
    harness
        .process(Op::AxClick(AxClickParams {
            ref_: reference,
            opts: None,
        }))
        .map_err(|error| error.code)
}

fn pointer_targets(harness: &Harness) -> Vec<Target> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::Pointer { target, .. } => Some(target),
            _ => None,
        })
        .collect()
}

#[test]
fn focused_ax_click_targets_owner_not_first_overlapping_window() {
    // Given: B covers A's focused AX element and is enumerated first.
    let mut harness = harness(&overlapping_windows());
    let reference = harness.focused_ref();
    // When: the desktop-scoped ref is clicked without a screenshot.
    let result = harness.process(Op::AxClick(AxClickParams {
        ref_: reference,
        opts: None,
    }));
    // Then: only A receives coordinate input.
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pointer_targets(&harness), [Target::Window("101".into())]);
}

#[test]
fn ax_click_ignores_unrelated_hit_test_target_provenance() {
    // Given: a hit test finds A's node even when the caller names B.
    let mut harness = harness(&overlapping_windows());
    let reference = match harness.process(Op::AxElementAt(AxElementAtParams {
        target: "202".into(),
        x: 120.0,
        y: 170.0,
    })) {
        Ok(Response::MaybeNode(Some(node))) => node.ref_,
        other => panic!("hit test failed: {other:?}"),
    };
    // When
    let result = harness.process(Op::AxClick(AxClickParams {
        ref_: reference,
        opts: None,
    }));
    // Then: snapshot provenance is not evidence of element ownership.
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pointer_targets(&harness), [Target::Window("101".into())]);
}

#[test]
fn ax_click_window_enumeration_failure_posts_no_input() {
    // Given: window availability cannot be established.
    let mut harness = harness(&overlapping_windows());
    let reference = harness.focused_ref();
    harness
        .faults
        .fail_next(FakeMethod::Windows, ErrorCode::WindowNotFound);
    // When
    let result = harness.process(Op::AxClick(AxClickParams {
        ref_: reference,
        opts: None,
    }));
    // Then: no pointer is delivered.
    assert_eq!(
        result.map_err(|error| error.code),
        Err(ErrorCode::WindowNotFound)
    );
    assert!(pointer_targets(&harness).is_empty());
}

#[test]
fn ax_click_refuses_an_unknown_owner_without_geometric_fallback() {
    // Given: B covers the focused element, whose owner the backend cannot name.
    let mut overlay = overlapping_windows();
    overlay["ax_owner_unknown"] = json!(true);
    let mut harness = harness(&overlay);
    let reference = harness.focused_ref();
    // When
    let result = click(&mut harness, reference);
    // Then: refused before any pointer event; B is not chosen by geometry.
    assert_eq!(result, Err(ErrorCode::AxFailed));
    assert!(pointer_targets(&harness).is_empty());
}

#[test]
fn ax_click_refuses_when_the_owner_no_longer_contains_the_centre() {
    // Given: A has moved off its element's centre, which B still covers.
    let mut harness = harness(&json!({"windows": [window("202", 8, 100), window("101", 4242, 1000)]}));
    let reference = harness.focused_ref();
    // When
    let result = click(&mut harness, reference);
    // Then: neither A nor B receives input.
    assert_eq!(result, Err(ErrorCode::AxFailed));
    assert!(pointer_targets(&harness).is_empty());
}

fn dense_object_harness() -> Harness {
    let scenario: Value = serde_json::from_str(include_str!("../../../senpi-desktop-backend-fake/fixtures/v2-ax-dense.json"))
        .expect("scenario is JSON");
    let options = senpi_desktop_core::types::DesktopSessionOptions {
        report_mode: senpi_desktop_core::report::ReportMode::Object,
        ..Default::default()
    };
    crate::test_support::harness_opened(&scenario, crate::grant::ControlSlot::new(), options)
}

fn dense_snapshot(harness: &mut Harness, timeout_ms: u64, max_nodes: Option<u32>) -> AxSnapshot {
    let opts = AxSnapshotOptions {
        timeout_ms: Some(timeout_ms),
        max_nodes,
        ..AxSnapshotOptions::default()
    };
    match harness.process(Op::AxSnapshot(AxSnapshotParams {
        target: "101".into(),
        opts: Some(opts),
    })) {
        Ok(Response::Snapshot(snapshot)) => snapshot,
        other => panic!("snapshot failed: {other:?}"),
    }
}

#[test]
fn a_dense_object_mode_snapshot_past_its_deadline_is_partial_and_marks_every_cut() {
    // Given: 10,000 nodes whose root takes the scripted 50 ms to list.
    let mut harness = dense_object_harness();
    // When
    let snapshot = dense_snapshot(&mut harness, 50, None);
    // Then: what was read comes back, and every cut node says so.
    assert_eq!(snapshot.complete, Some(false));
    assert!(snapshot.truncated, "v1 readers keep their truncated signal");
    assert!(snapshot.nodes_observed.is_some_and(|nodes| nodes > 0));
    assert!(!snapshot.cuts.is_empty());
    for cut in &snapshot.cuts {
        assert!(snapshot.text.contains(&format!("[ref={}]", cut.ref_)));
        assert!(snapshot.text.contains(&format!("[... {} more]", cut.child_count)));
        match harness.process(Op::AxNode(AxRefParams { ref_: cut.ref_.clone() })) {
            Ok(Response::Node(node)) => assert!(node.subtree_truncated, "{} is cut", cut.ref_),
            other => panic!("ax.node {} failed: {other:?}", cut.ref_),
        }
    }
}

#[test]
fn a_dense_object_mode_snapshot_within_its_deadline_is_complete() {
    // Given
    let mut harness = dense_object_harness();
    // When: 10 s is far past the scripted 50 ms stall.
    let snapshot = dense_snapshot(&mut harness, 10_000, Some(10_000));
    // Then
    assert_eq!(snapshot.complete, Some(true));
    assert!(!snapshot.truncated);
    assert_eq!(snapshot.nodes_observed, Some(10_000));
    assert!(snapshot.cuts.is_empty());
}

#[test]
fn an_object_mode_node_budget_cut_names_the_children_it_left_out() {
    // Given
    let mut harness = dense_object_harness();
    // When: three nodes fit the budget, the deadline does not bind.
    let snapshot = dense_snapshot(&mut harness, 10_000, Some(3));
    // Then: the root left the rest of its children out.
    assert_eq!(snapshot.complete, Some(false));
    assert_eq!(snapshot.nodes_observed, Some(3));
    let counts: Vec<u32> = snapshot.cuts.iter().map(|cut| cut.child_count).collect();
    assert_eq!(counts, [9_997]);
}
