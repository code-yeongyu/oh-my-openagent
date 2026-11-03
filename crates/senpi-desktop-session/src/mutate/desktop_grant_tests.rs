//! Input on the `desktop` or a `display:*` target is posted globally by every
//! backend (the user's real pointer and frontmost app), so it needs this
//! session's live control grant whatever delivery was requested (#10788).
//! Targeted background input to one window stays grant-free.

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{
    DragParams, HoldKeysParams, HoldMouseParams, KeyChordParams, PointParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::types::DesktopPoint;

use crate::request::Op;
use crate::test_support::{click_window, harness, op_names, two_windows};

fn click(target: &str, frame_id: &str) -> Op {
    Op::Click(PointParams {
        target: target.to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id.to_owned()),
        opts: None,
    })
}

/// Every pointer and keyboard request on `target`, with default delivery.
fn every_input(target: &str, frame_id: &str) -> Vec<(&'static str, Op)> {
    let point = || PointParams {
        target: target.to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id.to_owned()),
        opts: None,
    };
    vec![
        ("click", Op::Click(point())),
        ("moveMouse", Op::MoveMouse(point())),
        (
            "drag",
            Op::Drag(DragParams {
                target: target.to_owned(),
                path: vec![DesktopPoint { x: 10.0, y: 10.0 }, DesktopPoint { x: 20.0, y: 20.0 }],
                frame_id: Some(frame_id.to_owned()),
                opts: None,
            }),
        ),
        (
            "scroll",
            Op::Scroll(ScrollParams {
                target: target.to_owned(),
                x: 10.0,
                y: 10.0,
                dx: 0.0,
                dy: 3.0,
                frame_id: Some(frame_id.to_owned()),
                opts: None,
            }),
        ),
        (
            "typeText",
            Op::TypeText(TypeTextParams {
                target: target.to_owned(),
                text: "hi".to_owned(),
                opts: None,
            }),
        ),
        (
            "keyChord",
            Op::KeyChord(KeyChordParams {
                target: target.to_owned(),
                keys: vec!["cmd".to_owned(), "a".to_owned()],
                opts: None,
            }),
        ),
        (
            "holdKeys",
            Op::HoldKeys(HoldKeysParams {
                target: target.to_owned(),
                keys: vec!["shift".to_owned()],
                duration: 0.0,
                opts: None,
            }),
        ),
        (
            "holdMouse",
            Op::HoldMouse(HoldMouseParams {
                target: target.to_owned(),
                x: 10.0,
                y: 10.0,
                duration: 0.0,
                button: None,
                keys: None,
                frame_id: Some(frame_id.to_owned()),
                opts: None,
            }),
        ),
    ]
}

#[test]
fn desktop_coordinate_click_without_a_grant_is_refused_without_input() {
    // Given: no grant, a desktop capture
    let mut harness = harness(&two_windows());
    let frame = harness.capture("desktop");
    // When: the default (background) delivery is requested
    let reply = harness.process(click("desktop", &frame));
    // Then: refused at admission, nothing reached the backend, still audited
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(op_names(&harness), Vec::<&str>::new());
    let audited: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(audited, [Some(ErrorCode::ControlRequired)]);
}

#[test]
fn every_desktop_and_display_input_without_a_grant_is_refused_without_input() {
    for target in ["desktop", "display:1"] {
        for (name, op) in every_input(target, "unused") {
            // Given
            let mut harness = harness(&two_windows());
            let frame = harness.capture(target);
            let op = with_frame(op, &frame);
            // When
            let reply = harness.process(op);
            // Then
            assert_eq!(
                reply.map_err(|error| error.code),
                Err(ErrorCode::ControlRequired),
                "{name} on {target}"
            );
            assert_eq!(harness.sink.ops(), Vec::new(), "{name} on {target}");
        }
    }
}

#[test]
fn the_refusal_names_both_ways_out() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("desktop");
    // When
    let error = harness.process(click("desktop", &frame)).expect_err("needs the grant");
    // Then
    assert!(error.message.contains("target a window"), "{}", error.message);
    assert!(error.message.contains("computer.control.acquire"), "{}", error.message);
}

#[test]
fn a_granted_session_may_click_the_desktop() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("desktop");
    harness.grant("with the human watching");
    // When
    let reply = harness.process(click("desktop", &frame));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert!(op_names(&harness).contains(&"pointer"), "{:?}", op_names(&harness));
}

#[test]
fn background_input_to_one_window_stays_grant_free() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(op_names(&harness), ["pointer"]);
}

#[test]
fn a_clipboard_write_stays_grant_free() {
    // Given
    let mut harness = harness(&two_windows());
    // When
    let reply = harness.process(Op::ClipboardWrite(senpi_desktop_core::protocol_params::ClipboardText {
        text: "copied".to_owned(),
    }));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
}

fn with_frame(op: Op, frame: &str) -> Op {
    let frame = Some(frame.to_owned());
    match op {
        Op::Click(params) => Op::Click(PointParams { frame_id: frame, ..params }),
        Op::MoveMouse(params) => Op::MoveMouse(PointParams { frame_id: frame, ..params }),
        Op::Drag(params) => Op::Drag(DragParams { frame_id: frame, ..params }),
        Op::Scroll(params) => Op::Scroll(ScrollParams { frame_id: frame, ..params }),
        Op::HoldMouse(params) => Op::HoldMouse(HoldMouseParams { frame_id: frame, ..params }),
        other => other,
    }
}
