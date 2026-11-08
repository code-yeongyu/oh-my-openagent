use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{AxClickParams, AxElementAtParams};
use senpi_desktop_core::types::Target;
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
