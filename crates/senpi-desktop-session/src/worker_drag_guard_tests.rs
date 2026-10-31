//! The drag-and-drop guard over the fake (#11459, W3): a background
//! left-button drag or mouse hold runs only from a control that tracks it,
//! and a drag whose source picks up an item goes back to its start.

use senpi_desktop_backend_fake::{RecordedPointer, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{DragParams, HoldMouseParams};
use senpi_desktop_core::types::{DesktopPoint, PointerOptions};
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::test_support::{delivery, harness, Harness};

/// Window `101`, in the background behind `202`: a slider across its top and
/// a table row under it; `drag_guard` on, as macOS behaves.
fn guarded(picks_up: bool) -> Value {
    json!({
        "windows": [
            {"id": "101", "title": "Fonts", "app": "Font Book", "pid": 7, "x": 100, "y": 120,
             "width": 800, "height": 600, "focused": false, "elevated": null},
            {"id": "202", "title": "user.txt", "app": "TextEdit", "pid": 9, "x": 600, "y": 120,
             "width": 400, "height": 300, "focused": true, "elevated": null}
        ],
        "ax": {
            "101": {
                "role": "window", "native_role": "AXWindow", "title": "Fonts",
                "bounds": {"x": 100, "y": 120, "width": 800, "height": 600},
                "children": [
                    {"role": "slider", "native_role": "AXSlider", "title": "Size",
                     "bounds": {"x": 100, "y": 120, "width": 800, "height": 40}},
                    {"role": "row", "native_role": "AXRow", "title": "Serif",
                     "bounds": {"x": 100, "y": 200, "width": 800, "height": 40}}
                ]
            }
        },
        "drag_guard": true,
        "drag_picks_up": if picks_up { json!(["101"]) } else { json!([]) }
    })
}

fn drag(frame_id: &str, from_y: f64, opts: Option<PointerOptions>) -> Op {
    Op::Drag(DragParams {
        target: "101".to_owned(),
        path: vec![
            DesktopPoint { x: 10.0, y: from_y },
            DesktopPoint {
                x: 200.0,
                y: from_y,
            },
            DesktopPoint {
                x: 400.0,
                y: from_y,
            },
        ],
        frame_id: Some(frame_id.to_owned()),
        opts,
    })
}

fn drags(harness: &Harness) -> Vec<RecordedPointer> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::Pointer { event, .. } => Some(event),
            _ => None,
        })
        .collect()
}

#[test]
fn a_background_drag_from_a_row_is_refused_before_anything_is_sent() {
    let mut harness = harness(&guarded(false));
    let frame = harness.capture("101");
    let error = harness
        .process(drag(&frame, 100.0, None))
        .expect_err("refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("starts on an AXRow"),
        "{}",
        error.message
    );
    assert!(
        error.message.ends_with("nothing was sent"),
        "{}",
        error.message
    );
    assert!(drags(&harness).is_empty());
}

/// Window `100` of the same application covers window `101`'s start point
/// with a slider; it comes first in the fake's app-wide hit-test, as the
/// covering window does on macOS.
fn covered_by_a_sibling_window() -> Value {
    let mut scenario = guarded(false);
    scenario["windows"]
        .as_array_mut()
        .expect("windows")
        .push(json!(
            {"id": "100", "title": "Preview", "app": "Font Book", "pid": 7, "x": 100, "y": 200,
             "width": 300, "height": 100, "focused": false, "elevated": null}
        ));
    scenario["ax"]["100"] = json!({
        "role": "window", "native_role": "AXWindow", "title": "Preview",
        "bounds": {"x": 100, "y": 200, "width": 300, "height": 100},
        "children": [
            {"role": "slider", "native_role": "AXSlider", "title": "Zoom",
             "bounds": {"x": 100, "y": 200, "width": 300, "height": 100}}
        ]
    });
    scenario
}

#[test]
fn a_background_drag_whose_start_is_covered_by_a_sibling_windows_slider_is_refused() {
    let mut harness = harness(&covered_by_a_sibling_window());
    let frame = harness.capture("101");
    // The drag is routed to 101, where the start point is the Serif row; the
    // slider the hit-test finds belongs to 100, so it says nothing about 101.
    let error = harness
        .process(drag(&frame, 100.0, None))
        .expect_err("refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("another window of the application"),
        "{}",
        error.message
    );
    assert!(
        error.message.ends_with("nothing was sent"),
        "{}",
        error.message
    );
    assert!(drags(&harness).is_empty());
}

#[test]
fn a_background_drag_from_a_slider_is_delivered() {
    let mut harness = harness(&guarded(false));
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(drag(&frame, 20.0, None)),
        Ok(Response::Unit)
    );
    assert_eq!(drags(&harness).len(), 1);
}

#[test]
fn a_foreground_drag_from_a_row_is_not_the_guards_business() {
    let mut harness = harness(&guarded(false));
    harness.grant("drag a row");
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(drag(&frame, 100.0, delivery("foreground"))),
        Ok(Response::Unit)
    );
    assert_eq!(drags(&harness).len(), 1);
}

#[test]
fn a_background_mouse_hold_from_a_row_is_refused_before_anything_is_sent() {
    let mut harness = harness(&guarded(false));
    let frame = harness.capture("101");
    let error = harness
        .process(Op::HoldMouse(HoldMouseParams {
            target: "101".to_owned(),
            x: 10.0,
            y: 100.0,
            duration: 0.01,
            button: None,
            keys: None,
            frame_id: Some(frame),
            opts: None,
        }))
        .expect_err("refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("the mouse hold on window 101"),
        "{}",
        error.message
    );
    assert!(harness
        .sink
        .ops()
        .iter()
        .all(|op| !matches!(op, SinkOp::HeldButton { .. })));
}

#[test]
fn a_drag_whose_source_picks_up_an_item_goes_back_to_its_start() {
    let mut harness = harness(&guarded(true));
    let frame = harness.capture("101");
    let error = harness
        .process(drag(&frame, 20.0, None))
        .expect_err("picked up");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error.message.contains("released there"),
        "{}",
        error.message
    );
    // The press and the first move went out; the stroke came back to the start.
    let recorded = drags(&harness);
    let [RecordedPointer::Drag { path, .. }] = recorded.as_slice() else {
        panic!("one drag was recorded: {recorded:?}");
    };
    let xs: Vec<f64> = path.iter().map(|point| point.x).collect();
    assert_eq!(xs, [110.0, 300.0, 110.0]);
}

#[test]
fn without_the_guard_a_background_drag_from_a_row_still_delivers() {
    let mut scenario = guarded(false);
    scenario["drag_guard"] = json!(false);
    let mut harness = harness(&scenario);
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(drag(&frame, 100.0, None)),
        Ok(Response::Unit)
    );
    assert_eq!(drags(&harness).len(), 1);
}
