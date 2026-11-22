//! The occlusion check over a hit test that answers with the deepest element
//! under the point, as every backend now does: the target's own descendants
//! never cover it, another element of the same window does.

use senpi_desktop_backend_fake::FakeMethod;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::report::ReportMode;
use serde_json::{json, Value};

use super::{button, opened, press, pressed, scene, FakeTime};

/// More failed parent reads than the battery's polls within its wait.
const PARENT_FAILURES: usize = 400;

/// A focused list at 200,200 80x100 holding `rows`.
fn list(rows: &[Value]) -> Value {
    json!({"role": "list", "native_role": "AXList", "title": "Files", "focused": true,
           "bounds": {"x": 200, "y": 200, "width": 80, "height": 100}, "actions": ["press"], "children": rows})
}

#[test]
fn a_descendant_inside_the_target_is_not_occlusion() {
    // Given: the deepest element under the button's centre is its own label.
    let label = json!({"role": "text", "title": "Save", "bounds": {"x": 210, "y": 204, "width": 60, "height": 16}});
    let mut harness = opened(&scene(button(&json!({"children": [label]})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn a_descendant_overhanging_the_target_is_not_occlusion() {
    // Given: the deepest element under the list's centre is its own row, wider than the list's viewport.
    let row = json!({"role": "row", "title": "notes.txt", "bounds": {"x": 200, "y": 240, "width": 300, "height": 24}});
    let mut harness = opened(&scene(list(&[row]), &[]), ReportMode::Object);
    harness.worker.battery_clock = Box::new(FakeTime(harness.ax_clock.clone()));
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn a_hit_whose_parents_cannot_be_read_is_not_occlusion() {
    // Given: the overhanging row again, and every parent read of the walk fails.
    let row = json!({"role": "row", "title": "notes.txt", "bounds": {"x": 200, "y": 240, "width": 300, "height": 24}});
    let mut harness = opened(&scene(list(&[row]), &[]), ReportMode::Object);
    harness.worker.battery_clock = Box::new(FakeTime(harness.ax_clock.clone()));
    for _ in 0..PARENT_FAILURES {
        harness.faults.fail_next(FakeMethod::AxParent, ErrorCode::AxFailed);
    }
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then: what the walk cannot establish counts as not covered, as the owner read does.
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn another_element_of_the_window_over_the_target_is_occlusion() {
    // Given: a banner of the same window lies across the button's centre.
    let banner = json!({"role": "group", "title": "Banner", "bounds": {"x": 150, "y": 205, "width": 300, "height": 10}});
    let mut harness = opened(&scene(button(&json!({})), &[banner]), ReportMode::Object);
    harness.worker.battery_clock = Box::new(FakeTime(harness.ax_clock.clone()));
    let reference = harness.focused_ref();
    // When
    let error = press(&mut harness, reference).expect_err("refused");
    // Then
    assert_eq!(super::report(&error).reason.as_deref(), Some("occluded"), "{error}");
    assert_eq!(pressed(&harness), 0);
}
