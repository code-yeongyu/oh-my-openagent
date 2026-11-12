//! Every frame refusal sends nothing: frame required, wrong target, no capture, superseded,
//! consumed, identity changed, resized, pixels only and outside the frame.

use std::sync::{Arc, Mutex};

use omo_computer_core::listing::Rect;
use serde_json::json;

use super::helpers::{
    click, fake, frame, frame_refused, moves_to, opened, refused, session, Shared, WINDOW,
};

#[test]
fn frame_refused_frame_required() {
    let (mut session, sink) = session(&json!({}));
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "frame_required",
    );
    assert!(sink.is_empty());
}

#[test]
fn frame_refused_wrong_target() {
    let (mut session, sink) = session(&json!({}));
    let display = frame(&mut session, "display:1");
    frame(&mut session, "101");
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": display.frame_id});
    frame_refused(&mut session, &sink, call, "wrong_target");
}

#[test]
fn frame_refused_no_capture() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": "frame-never-issued"});
    frame_refused(&mut session, &sink, call, "no_capture");
}

#[test]
fn frame_refused_superseded() {
    let (mut session, sink) = session(&json!({}));
    let first = frame(&mut session, "101");
    let second = frame(&mut session, "101");
    assert_ne!(
        first.frame_id, second.frame_id,
        "a frame id is never issued twice"
    );
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": first.frame_id});
    frame_refused(&mut session, &sink, call, "superseded");
    let latest = json!({"target": "101", "x": 10, "y": 10, "frameId": second.frame_id});
    click(&mut session, latest).expect("the latest frame takes input");
}

#[test]
fn frame_refused_consumed() {
    let (mut session, sink) = session(&json!({}));
    let captured = frame(&mut session, "101");
    click(
        &mut session,
        json!({"target": "101", "x": 10, "y": 10, "consume": true}),
    )
    .expect("delivered");
    assert_eq!(sink.len(), 3, "move, down, up: {:?}", sink.lines());
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "consumed",
    );
    let named = json!({"target": "101", "x": 10, "y": 10, "frameId": captured.frame_id});
    frame_refused(&mut session, &sink, named, "consumed");
}

#[test]
fn a_call_without_consume_and_a_refusal_never_consume() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 9000, "y": 10, "consume": true}),
        "outside_frame",
    );
    click(&mut session, json!({"target": "101", "x": 10, "y": 10})).expect("delivered");
    click(
        &mut session,
        json!({"target": "101", "x": 10, "y": 10, "consume": true}),
    )
    .expect("still unconsumed");
}

#[test]
fn frame_refused_identity_changed() {
    let changes = json!({"identity_changes": [
        {"after_call": "capture", "window": "101", "new_pid": 5151, "new_processStart": 1_700_000_999}
    ]});
    let (mut session, sink) = session(&changes);
    frame(&mut session, "101");
    refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "WindowNotFound",
        "identity_changed",
    );
}

#[test]
fn frame_refused_resized() {
    let (backend, sink) = fake(&json!({}));
    let shared = Shared(Arc::new(Mutex::new(backend)));
    let mut session = opened(Box::new(shared.clone()));
    frame(&mut session, "101");
    shared
        .fake()
        .set_frame("101", Rect { x: 0.0, ..WINDOW })
        .expect("moved");
    click(&mut session, json!({"target": "101", "x": 10, "y": 10}))
        .expect("a moved window re-anchors");
    assert_eq!(moves_to(&sink, 10.0, 130.0), 1, "{:?}", sink.lines());
    shared
        .fake()
        .set_frame(
            "101",
            Rect {
                width: 640.0,
                ..WINDOW
            },
        )
        .expect("resized");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "resized",
    );
}

#[test]
fn frame_refused_pixels_only() {
    let (mut session, sink) = session(&json!({"persona": "wayland"}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "pixels_only",
    );
    assert!(sink.is_empty());
}

#[test]
fn frame_refused_outside_frame() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 900, "y": 10}),
        "outside_frame",
    );
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 600}),
        "outside_frame",
    );
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": -1, "y": 10}),
        "outside_frame",
    );
    assert!(sink.is_empty());
}
