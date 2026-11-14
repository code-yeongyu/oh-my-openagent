//! Requests and scenarios the session tests build again and again: grants,
//! clicks, a two-window scene, and the op names a transaction recorded.

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::protocol_params::{ControlGrantParams, PointParams};
use senpi_desktop_core::types::{PointerOptions, Target};
use senpi_desktop_safety::MutatingAction;
use serde_json::{json, Value};

use super::Harness;
use crate::mutate::Mutation;
use crate::request::Op;
use crate::worker::Worker;

pub(crate) fn delivery(mode: &str) -> Option<PointerOptions> {
    Some(PointerOptions {
        delivery_mode: Some(mode.to_owned()),
        ..PointerOptions::default()
    })
}

/// A `control.grant` request for `reason` with a fixed confirmation id.
pub(crate) fn grant_control(reason: &str) -> Op {
    Op::ControlGrant(ControlGrantParams {
        reason: reason.to_owned(),
        confirmation_id: "confirm-1".to_owned(),
    })
}

/// A click at pixel (10, 10) of `frame_id`, a capture of window `101`.
pub(crate) fn click_window(frame_id: &str, opts: Option<PointerOptions>) -> Op {
    Op::Click(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id.to_owned()),
        opts,
    })
}

/// Window `101` behind the focused window `202`; the cursor rests at (960, 540).
pub(crate) fn two_windows() -> Value {
    let window = |id: &str, x: u32, focused: bool| {
        json!({"id": id, "title": id, "app": "App", "pid": 7, "x": x, "y": 120,
               "width": 400, "height": 300, "focused": focused, "elevated": null})
    };
    json!({"windows": [window("101", 100, false), window("202", 600, true)], "ax": {}})
}

pub(crate) fn op_names(harness: &Harness) -> Vec<&'static str> {
    harness
        .sink
        .ops()
        .iter()
        .map(|op| match op {
            SinkOp::QueryFrontWindow => "front",
            SinkOp::Pointer { .. } => "pointer",
            SinkOp::TypeText { .. } => "type",
            SinkOp::KeyChord { .. } => "key",
            SinkOp::RestoreFrontWindow(_) => "restore-front",
            SinkOp::RestoreKeyFocus(_) => "restore-key-focus",
            SinkOp::WarpCursor(_) => "warp",
            SinkOp::ReleaseAll => "release",
            _ => "other",
        })
        .collect()
}

/// A real foreground click into window `101`, run as a transaction's action.
pub(crate) fn foreground_click(worker: &mut Worker) -> CoreResult<()> {
    let event = PointerEvent::Click {
        x: 150.0,
        y: 150.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    let target = Target::Window("101".to_owned());
    worker.backend()?.pointer(
        &target,
        event,
        &FrameGeometry::identity_global(),
        DeliveryMode::Foreground,
    )
}

pub(crate) fn foreground_click_mutation() -> Mutation<'static> {
    Mutation::new(MutatingAction::Click, "101".to_owned(), DeliveryMode::Foreground)
}
