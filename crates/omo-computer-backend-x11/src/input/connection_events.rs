//! Core `XSendEvent` encoding for [`InputConnection`]: the background route's key and button
//! events, sent to one window.

use x11rb::protocol::xproto::{
    ButtonPressEvent, ConnectionExt as _, EventMask, KeyButMask, KeyPressEvent, BUTTON_PRESS_EVENT,
    BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT, KEY_RELEASE_EVENT,
};
use x11rb::CURRENT_TIME;

use super::connection::{x, InputConnection};
use super::server::{SentEvent, Window, XError};

impl InputConnection {
    pub(super) fn send_event(&self, window: Window, event: SentEvent) -> Result<(), XError> {
        let cookie = match event {
            SentEvent::Key { code, press, state } => {
                let event = KeyPressEvent {
                    response_type: if press {
                        KEY_PRESS_EVENT
                    } else {
                        KEY_RELEASE_EVENT
                    },
                    detail: code,
                    sequence: 0,
                    time: CURRENT_TIME,
                    root: self.root,
                    event: window,
                    child: 0,
                    root_x: 0,
                    root_y: 0,
                    event_x: 0,
                    event_y: 0,
                    state: KeyButMask::from(state),
                    same_screen: true,
                };
                let mask = if press {
                    EventMask::KEY_PRESS
                } else {
                    EventMask::KEY_RELEASE
                };
                self.conn.send_event(false, window, mask, event)
            }
            SentEvent::Button {
                detail,
                press,
                root,
                local,
            } => {
                let event = ButtonPressEvent {
                    response_type: if press {
                        BUTTON_PRESS_EVENT
                    } else {
                        BUTTON_RELEASE_EVENT
                    },
                    detail,
                    sequence: 0,
                    time: CURRENT_TIME,
                    root: self.root,
                    event: window,
                    child: 0,
                    root_x: root.0,
                    root_y: root.1,
                    event_x: local.0,
                    event_y: local.1,
                    state: KeyButMask::from(0u16),
                    same_screen: true,
                };
                let mask = if press {
                    EventMask::BUTTON_PRESS
                } else {
                    EventMask::BUTTON_RELEASE
                };
                self.conn.send_event(false, window, mask, event)
            }
        };
        cookie.map_err(x)?.check().map_err(x)
    }
}
