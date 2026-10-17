//! Core `XSendEvent` encoding for the live X11 input connection.

use senpi_desktop_core::error::CoreResult;
use x11rb::protocol::xproto::{
    ButtonPressEvent, ConnectionExt as _, EventMask, KeyButMask, KeyPressEvent, Motion,
    MotionNotifyEvent, Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT,
    KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
};
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use super::connection::{failed, pick};
use super::server::SentEvent;

pub(super) fn send(
    conn: &RustConnection,
    root: Window,
    window: Window,
    event: SentEvent,
) -> CoreResult<()> {
    let cookie = match event {
        SentEvent::Key { code, press, state } => {
            let event = KeyPressEvent {
                response_type: pick(press, KEY_PRESS_EVENT, KEY_RELEASE_EVENT),
                detail: code,
                sequence: 0,
                time: CURRENT_TIME,
                root,
                event: window,
                child: 0,
                root_x: 0,
                root_y: 0,
                event_x: 0,
                event_y: 0,
                state: KeyButMask::from(state),
                same_screen: true,
            };
            let mask = pick(press, EventMask::KEY_PRESS, EventMask::KEY_RELEASE);
            conn.send_event(false, window, mask, event)
        }
        SentEvent::Button {
            detail,
            press,
            at,
            state,
        } => {
            let event = ButtonPressEvent {
                response_type: pick(press, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT),
                detail,
                sequence: 0,
                time: CURRENT_TIME,
                root,
                event: window,
                child: 0,
                root_x: at.root.0,
                root_y: at.root.1,
                event_x: at.local.0,
                event_y: at.local.1,
                state: KeyButMask::from(state),
                same_screen: true,
            };
            let mask = pick(press, EventMask::BUTTON_PRESS, EventMask::BUTTON_RELEASE);
            conn.send_event(false, window, mask, event)
        }
        SentEvent::Motion { at, state } => {
            let event = MotionNotifyEvent {
                response_type: MOTION_NOTIFY_EVENT,
                detail: Motion::NORMAL,
                sequence: 0,
                time: CURRENT_TIME,
                root,
                event: window,
                child: 0,
                root_x: at.root.0,
                root_y: at.root.1,
                event_x: at.local.0,
                event_y: at.local.1,
                state: KeyButMask::from(state),
                same_screen: true,
            };
            conn.send_event(false, window, EventMask::POINTER_MOTION, event)
        }
    };
    cookie.map_err(failed)?.check().map_err(failed)
}
