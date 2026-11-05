//! D1 over the fake for mouse holds (#11459, W3): a background `holdMouse`
//! that would open a menu (a secondary button, a Control-left press, a left
//! press on a menu control) is delivered as the one press that opens it, and
//! the menu is read and closed in the same call; the hold never keeps a
//! background menu open. Other holds, and holds in the user's front app, are
//! held as before.

use senpi_desktop_backend_fake::{RecordedPointer, SinkOp};
use senpi_desktop_core::backend::{Modifiers, MouseButton};
use senpi_desktop_core::protocol_params::HoldMouseParams;

use super::worker_menu_background_tests::{fixture, menu_ops};
use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

fn hold(frame_id: &str, x: f64, y: f64, button: &str, keys: &[&str]) -> Op {
    Op::HoldMouse(HoldMouseParams {
        target: "101".to_owned(),
        x,
        y,
        duration: 0.0,
        button: Some(button.to_owned()),
        keys: Some(keys.iter().map(|key| (*key).to_owned()).collect()),
        frame_id: Some(frame_id.to_owned()),
        opts: None,
    })
}

fn pointer_ops(harness: &Harness) -> Vec<RecordedPointer> {
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

fn held_buttons(harness: &Harness) -> usize {
    harness
        .sink
        .ops()
        .iter()
        .filter(|op| matches!(op, SinkOp::HeldButton { .. }))
        .count()
}

#[test]
fn background_hold_menu_routing_covers_buttons_modifiers_and_extra_keys() {
    let modifiers: [(&str, &[&str], Modifiers); 4] = [
        ("none", &[], Modifiers::default()),
        (
            "ctrl",
            &["ctrl"],
            Modifiers {
                ctrl: true,
                ..Modifiers::default()
            },
        ),
        (
            "cmd",
            &["cmd"],
            Modifiers {
                meta: true,
                ..Modifiers::default()
            },
        ),
        (
            "shift",
            &["shift"],
            Modifiers {
                shift: true,
                ..Modifiers::default()
            },
        ),
    ];
    let extra_keys: [(&str, &[&str]); 3] = [
        ("no key", &[]),
        ("ordinary key", &["space"]),
        ("modifier-only key", &["alt"]),
    ];
    let mut failures = Vec::new();
    for (button_name, button) in [("left", MouseButton::Left), ("right", MouseButton::Right)] {
        for (modifier_name, base_keys, base_modifiers) in modifiers {
            for (extra_name, extra) in extra_keys {
                let keys: Vec<_> = base_keys.iter().chain(extra).copied().collect();
                let expected_modifiers = Modifiers {
                    alt: !extra.is_empty() && extra[0] == "alt",
                    ..base_modifiers
                };
                // Context menus depend on button/Control, never on extra keys.
                let expects_menu = button == MouseButton::Right || base_modifiers.ctrl;
                let kind = format!("{button_name} / {modifier_name} / {extra_name}");
                let mut harness = harness(&fixture(false));
                let frame = harness.capture("101");
                assert_eq!(
                    harness.process(hold(&frame, 300.0, 300.0, button_name, &keys)),
                    Ok(Response::Unit),
                    "{kind}"
                );
                let closed = menu_ops(&harness);
                let pressed = pointer_ops(&harness);
                let held_keys = harness
                    .sink
                    .ops()
                    .iter()
                    .filter(|op| matches!(op, SinkOp::HeldKey { .. }))
                    .count();
                let correct = if expects_menu {
                    closed
                        == [SinkOp::MenuClosed {
                            window: "101".to_owned(),
                        }]
                        && held_buttons(&harness) == 0
                        && held_keys == 0
                        && matches!(pressed.as_slice(), [RecordedPointer::Click { count: 1, button: actual, modifiers, .. }]
                            if *actual == button && *modifiers == expected_modifiers)
                } else {
                    closed.is_empty()
                        && pressed.is_empty()
                        && held_buttons(&harness) == 2
                        && held_keys == keys.len() * 2
                };
                if !correct {
                    failures.push(format!("{kind}: expected {}, closed={closed:?}, pressed={pressed:?}, held_buttons={}, held_keys={held_keys}",
                        if expects_menu { "one menu press and close" } else { "ordinary hold" }, held_buttons(&harness)));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn a_popup_button_hold_with_an_ordinary_key_still_closes_its_menu() {
    let mut harness = harness(&fixture(false));
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(hold(&frame, 20.0, 50.0, "left", &["space"])),
        Ok(Response::Unit)
    );
    assert_eq!(
        menu_ops(&harness),
        [SinkOp::MenuClosed {
            window: "101".to_owned()
        }]
    );
    assert_eq!(held_buttons(&harness), 0);
}

#[test]
fn holds_that_open_no_menu_are_held_as_before() {
    // A left hold on the Save button (pixel (720, 570)) opens nothing: the
    // button is pressed, held and released, and no menu is watched.
    let mut harness = harness(&fixture(false));
    let frame = harness.capture("101");
    assert_eq!(
        harness.process(hold(&frame, 720.0, 570.0, "left", &[])),
        Ok(Response::Unit)
    );
    assert!(menu_ops(&harness).is_empty());
    assert_eq!(held_buttons(&harness), 2, "a press and its release");
    assert!(pointer_ops(&harness).is_empty());
    // A right hold in the user's front app: its menu is the user's and stays.
    let mut front = crate::test_support::harness(&fixture(true));
    let frame = front.capture("101");
    assert_eq!(
        front.process(hold(&frame, 300.0, 300.0, "right", &[])),
        Ok(Response::Unit)
    );
    assert!(menu_ops(&front).is_empty());
    assert_eq!(held_buttons(&front), 2);
}
