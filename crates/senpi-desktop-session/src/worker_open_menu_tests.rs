//! The `menu` option of `click`, `ax.click` and `ax.perform` over the fake's
//! scripted context menus (#11459, W3): the item is chosen in the call that
//! opens the menu, and the menu is closed whatever happened.

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{AxClickParams, AxPerformParams, PointParams};
use senpi_desktop_core::types::PointerOptions;
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

/// The fixture's window `101` with a context menu of three items, the last
/// disabled, and a popup button whose menu is the same list.
fn finder_like() -> Value {
    json!({
        "context_menus": {
            "101": [
                {"title": "Rename"},
                {"title": "Duplicate"},
                {"title": "Delete", "enabled": false}
            ]
        },
        "ax": {
            "101": {
                "role": "window", "native_role": "AXWindow", "title": "Untitled - Notes",
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

fn right_click(frame_id: &str, menu: &[&str]) -> Op {
    Op::Click(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id.to_owned()),
        opts: Some(PointerOptions {
            button: Some("right".to_owned()),
            ..PointerOptions::default()
        }),
        menu: Some(menu.iter().map(ToString::to_string).collect()),
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

fn menu_ops(harness: &Harness) -> Vec<SinkOp> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter(|op| matches!(op, SinkOp::MenuChosen { .. } | SinkOp::MenuClosed { .. }))
        .collect()
}

#[test]
fn a_right_click_with_a_menu_path_chooses_the_item_in_the_menu_it_opened() {
    let mut harness = harness(&finder_like());
    let frame = harness.capture("101");
    let reply = harness.process(right_click(&frame, &["rename"]));
    assert_eq!(reply, Ok(Response::Unit));
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuChosen {
            window: "101".to_owned(),
            path: vec!["Rename".to_owned()],
        }]
    );
    let audit = harness.audits().pop().expect("the click is audited");
    assert_eq!(
        (audit.action, audit.code),
        (senpi_desktop_core::methods::Method::Click, None)
    );
}

#[test]
fn a_path_that_matches_nothing_closes_the_menu_and_lists_its_items() {
    let mut harness = harness(&finder_like());
    let frame = harness.capture("101");
    let error = harness
        .process(right_click(&frame, &["Nope"]))
        .expect_err("refused");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error.message.contains("menu item 'Nope' was not found"),
        "{}",
        error.message
    );
    assert!(
        error
            .message
            .ends_with("Items: \"Rename\", \"Duplicate\", \"Delete\" (disabled)."),
        "{}",
        error.message
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
}

#[test]
fn a_press_that_opens_no_menu_fails_as_delivered_when_a_path_was_given() {
    let mut harness = harness(&finder_like());
    let frame = harness.capture("101");
    let plain_left = Op::Click(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame),
        opts: None,
        menu: Some(vec!["Rename".to_owned()]),
    });
    let error = harness.process(plain_left).expect_err("no menu");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error
            .message
            .contains("opened no menu, so nothing was chosen"),
        "{}",
        error.message
    );
    assert!(menu_ops(&harness).is_empty());
    assert!(
        harness
            .sink
            .ops()
            .iter()
            .any(|op| matches!(op, SinkOp::Pointer { .. })),
        "the click went out"
    );
}

#[test]
fn an_empty_menu_path_is_refused_before_anything_is_sent() {
    let mut harness = harness(&finder_like());
    let frame = harness.capture("101");
    let error = harness
        .process(right_click(&frame, &[]))
        .expect_err("refused");
    assert_eq!(error.code, ErrorCode::InvalidTarget);
    assert!(harness
        .sink
        .ops()
        .iter()
        .all(|op| !matches!(op, SinkOp::Pointer { .. })));
}

#[test]
fn show_menu_on_an_element_chooses_the_item_in_the_menu_it_opened() {
    let mut harness = harness(&finder_like());
    let save = ref_titled(&mut harness, "Save");
    let reply = harness.process(Op::AxPerform(AxPerformParams {
        ref_: save,
        action: "showMenu".to_owned(),
        menu: Some(vec!["Duplicate".to_owned()]),
    }));
    assert_eq!(reply, Ok(Response::Unit));
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuChosen {
            window: "101".to_owned(),
            path: vec!["Duplicate".to_owned()],
        }]
    );
}

#[test]
fn a_disabled_item_is_refused_and_the_menu_closed() {
    let mut harness = harness(&finder_like());
    let save = ref_titled(&mut harness, "Save");
    let error = harness
        .process(Op::AxPerform(AxPerformParams {
            ref_: save,
            action: "showMenu".to_owned(),
            menu: Some(vec!["Delete".to_owned()]),
        }))
        .expect_err("disabled");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error.message.contains("menu item 'Delete' is disabled"),
        "{}",
        error.message
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
}

#[test]
fn clicking_a_popup_button_with_a_path_chooses_in_its_menu() {
    let mut harness = harness(&finder_like());
    let kind = ref_titled(&mut harness, "Kind");
    let reply = harness.process(Op::AxClick(AxClickParams {
        ref_: kind,
        opts: None,
        menu: Some(vec!["Rename".to_owned()]),
    }));
    assert_eq!(reply, Ok(Response::Unit));
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuChosen {
            window: "101".to_owned(),
            path: vec!["Rename".to_owned()],
        }]
    );
}

#[test]
fn a_stop_after_the_press_closes_the_menu_and_presses_nothing() {
    let mut harness = harness(&finder_like());
    let frame = harness.capture("101");
    // The stop lands while the click is out and its menu has not been handled
    // yet: the menu is closed, its item is not pressed, and the stop is what
    // the call reports.
    let supervisor = std::sync::Arc::clone(&harness.supervisor);
    harness
        .faults
        .on_next(FakeMethod::Click, move || supervisor.suspend_input());
    let error = harness
        .process(right_click(&frame, &["Rename"]))
        .expect_err("suspended");
    assert_eq!(error.code, ErrorCode::Suspended);
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
}
