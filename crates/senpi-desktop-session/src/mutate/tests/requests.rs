use senpi_desktop_core::protocol_params::{
    AxClickParams, AxPerformParams, AxRefParams, AxSetValueParams, ClipboardText,
    DragParams, HoldKeysParams, HoldMouseParams, KeyChordParams, MenuSelectParams,
    PointParams, RaiseWindowParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::types::DesktopPoint;
use senpi_desktop_safety::MutatingAction;

use crate::request::Op;
use crate::test_support::{click_window, Harness};

/// A valid request for each gated action against the owner test's fixture.
pub(super) fn request_for(harness: &mut Harness, action: MutatingAction) -> Op {
    let frame = harness.capture("101");
    let frame_id = Some(frame.clone());
    let reference = harness.focused_ref();
    let target = "101".to_owned();
    let point = |x, y| DesktopPoint { x, y };
    match action {
        MutatingAction::Click => click_window(&frame, None),
        MutatingAction::MoveMouse => Op::MoveMouse(PointParams {
            target, x: 10.0, y: 10.0, frame_id, opts: None,
        }),
        MutatingAction::Drag => Op::Drag(DragParams {
            target, path: vec![point(10.0, 10.0), point(40.0, 40.0)], frame_id, opts: None,
        }),
        MutatingAction::Scroll => Op::Scroll(ScrollParams {
            target, x: 10.0, y: 10.0, dx: 0.0, dy: 3.0, frame_id, opts: None,
        }),
        MutatingAction::TypeText => Op::TypeText(TypeTextParams {
            target, text: "hello".to_owned(), opts: None,
        }),
        MutatingAction::KeyChord => Op::KeyChord(KeyChordParams {
            target, keys: vec!["shift+a".to_owned()], opts: None,
        }),
        MutatingAction::HoldKeys => Op::HoldKeys(HoldKeysParams {
            target,
            keys: vec!["shift+a".to_owned()],
            duration: 0.0,
            opts: None,
        }),
        MutatingAction::HoldMouse => Op::HoldMouse(HoldMouseParams {
            target,
            x: 10.0,
            y: 10.0,
            duration: 0.0,
            button: None,
            keys: None,
            frame_id,
            opts: None,
        }),
        MutatingAction::RaiseWindow => Op::RaiseWindow(RaiseWindowParams { window_id: target }),
        MutatingAction::AxPerform => Op::AxPerform(AxPerformParams {
            ref_: reference, action: "focus".to_owned(),
        }),
        MutatingAction::AxSetValue => Op::AxSetValue(AxSetValueParams {
            ref_: reference, value: "hello".to_owned(),
        }),
        MutatingAction::AxFocus => Op::AxFocus(AxRefParams { ref_: reference }),
        MutatingAction::AxClick => Op::AxClick(AxClickParams { ref_: reference, opts: None }),
        MutatingAction::ClipboardWrite => Op::ClipboardWrite(ClipboardText { text: "hello".to_owned() }),
        MutatingAction::MenuSelect => Op::MenusSelect(MenuSelectParams {
            window_id: target, path: vec!["File".to_owned(), "Save".to_owned()], delivery_mode: None,
        }),
    }
}
