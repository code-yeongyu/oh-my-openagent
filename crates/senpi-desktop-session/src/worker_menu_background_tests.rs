//! D1 over the fake (#11459, W3): every background input that opens a menu
//! goes through the open-menu flow even without `menu:`; the menu is read and
//! closed at once and the call succeeds with the items, never refused, never
//! left open. A frontmost application's menu is the user's and stays.

use senpi_desktop_backend_fake::{RecordedPointer, SinkOp};
use senpi_desktop_core::protocol_params::{AxPerformParams, DragParams, PointParams};
use senpi_desktop_core::protocol_results::MenuReport;
use senpi_desktop_core::types::{DesktopPoint, PointerOptions};
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

/// Window `101` with a context menu, a plain Save button and a Kind popup
/// button; `focused` says whether it is the user's front window.
pub(super) fn fixture(focused: bool) -> Value {
    json!({
        "windows": [
            {"id": "101", "title": "Fonts", "app": "Font Book", "pid": 7, "x": 100, "y": 120,
             "width": 800, "height": 600, "focused": focused, "elevated": null}
        ],
        "context_menus": {"101": [{"title": "Rename"}, {"title": "Duplicate"}, {"title": "Delete", "enabled": false}]},
        "ax": {
            "101": {
                "role": "window", "native_role": "AXWindow", "title": "Fonts",
                "bounds": {"x": 100, "y": 120, "width": 800, "height": 600},
                "children": [
                    {"role": "button", "native_role": "AXButton", "title": "Save",
                     "bounds": {"x": 800, "y": 680, "width": 80, "height": 30}, "actions": ["press", "showMenu"]},
                    {"role": "popupbutton", "native_role": "AXPopUpButton", "title": "Kind",
                     "bounds": {"x": 110, "y": 160, "width": 120, "height": 30}, "actions": ["press"]}
                ]
            }
        }
    })
}

const LISTED: &str = "\"Rename\", \"Duplicate\", \"Delete\" (disabled)";

fn listed() -> Response {
    Response::MenuOutcome(Some(MenuReport {
        items: LISTED.to_owned(),
    }))
}

fn click(frame_id: &str, x: f64, y: f64, button: &str) -> Op {
    Op::Click(PointParams {
        target: "101".to_owned(),
        x,
        y,
        frame_id: Some(frame_id.to_owned()),
        opts: Some(PointerOptions {
            button: Some(button.to_owned()),
            ..PointerOptions::default()
        }),
        menu: None,
    })
}

fn ref_titled(harness: &mut Harness, title: &str) -> String {
    let query = senpi_desktop_core::types::AxQuery {
        title: Some(title.to_owned()),
        ..senpi_desktop_core::types::AxQuery::default()
    };
    match harness.process(Op::AxQuery(
        senpi_desktop_core::protocol_params::AxQueryParams {
            target: "101".to_owned(),
            query,
        },
    )) {
        Ok(Response::Nodes(nodes)) => nodes[0].ref_.clone(),
        other => panic!("no element titled {title}: {other:?}"),
    }
}

pub(super) fn menu_ops(harness: &Harness) -> Vec<SinkOp> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter(|op| matches!(op, SinkOp::MenuChosen { .. } | SinkOp::MenuClosed { .. }))
        .collect()
}

#[test]
fn a_background_right_click_without_a_path_lists_the_menu_and_closes_it() {
    let mut harness = harness(&fixture(false));
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(click(&frame, 300.0, 300.0, "right")),
        Ok(listed())
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
}

#[test]
fn a_frontmost_right_click_without_a_path_is_delivered_plainly() {
    // The user's own app: its menu stays open for the next call, as the
    // user's would; nothing is watched or closed.
    let mut harness = harness(&fixture(true));
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(click(&frame, 300.0, 300.0, "right")),
        Ok(Response::MenuOutcome(None))
    );
    assert!(menu_ops(&harness).is_empty());
}

#[test]
fn a_background_left_click_on_a_popup_button_lists_its_menu() {
    let mut harness = harness(&fixture(false));
    let frame = harness.capture("101");
    // Pixel (20, 50) of the capture is global (120, 170): inside Kind.
    assert_eq!(
        harness.process(click(&frame, 20.0, 50.0, "left")),
        Ok(listed())
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
    // A plain button opens nothing: delivered as before, nothing watched.
    let mut plain = crate::test_support::harness(&fixture(false));
    let frame = plain.capture("101");
    assert_eq!(
        plain.process(click(&frame, 720.0, 570.0, "left")),
        Ok(Response::MenuOutcome(None))
    );
    assert!(menu_ops(&plain).is_empty());
}

#[test]
fn a_drag_from_a_popup_button_in_the_background_is_one_press_that_lists_its_menu() {
    let mut harness = harness(&fixture(false));
    let frame = harness.capture("101");
    let drag = Op::Drag(DragParams {
        target: "101".to_owned(),
        path: vec![
            DesktopPoint { x: 20.0, y: 50.0 },
            DesktopPoint { x: 200.0, y: 50.0 },
        ],
        frame_id: Some(frame),
        opts: None,
    });
    assert_eq!(harness.process(drag), Ok(listed()));
    let pressed: Vec<RecordedPointer> = harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::Pointer { event, .. } => Some(event),
            _ => None,
        })
        .collect();
    assert!(
        matches!(
            pressed.as_slice(),
            [RecordedPointer::Click { count: 1, .. }]
        ),
        "one press, not a drag: {pressed:?}"
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
}

#[test]
fn show_menu_without_a_path_on_a_background_element_lists_and_closes() {
    let mut harness = harness(&fixture(false));
    let save = ref_titled(&mut harness, "Save");
    let reply = harness.process(Op::AxPerform(AxPerformParams {
        ref_: save.clone(),
        action: "showMenu".to_owned(),
        menu: None,
    }));
    assert_eq!(reply, Ok(listed()));
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
    // A press on a plain button opens no menu: performed plainly.
    let reply = harness.process(Op::AxPerform(AxPerformParams {
        ref_: save,
        action: "press".to_owned(),
        menu: None,
    }));
    assert_eq!(reply, Ok(Response::MenuOutcome(None)));
    assert_eq!(menu_ops(&harness).len(), 1);
}
