//! The window-manager half of [`InputConnection`]: EWMH client messages, frames in root
//! coordinates, the `ConfigureNotify` wait, and the evidence of a window's client. The client's
//! pid comes from the X server (X-Resource `LocalClientPID`), never from the client-written
//! `_NET_WM_PID`, and only when the server sees this engine under its own pid (same namespace).

use std::path::Path;
use std::time::{Duration, Instant};

use omo_computer_core::listing::Rect;
use x11rb::connection::Connection;
use x11rb::protocol::res::{ClientIdMask, ClientIdSpec, ConnectionExt as _};
use x11rb::protocol::xproto::{
    AtomEnum, ChangeWindowAttributesAux, ClientMessageData, ClientMessageEvent, ConnectionExt as _,
    EventMask, CLIENT_MESSAGE_EVENT,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use super::connection::{x, InputConnection};
use super::server::{Window, WmRequest, XError};
use crate::toolkit::{read_evidence, Evidence};

const ICONIC_STATE: u32 = 3;
/// Source indication 2: a tool acting for the user (EWMH).
const SOURCE_TOOL: u32 = 2;
/// After the first `ConfigureNotify`, the move and the resize may arrive as separate notifies.
const SETTLE: Duration = Duration::from_millis(50);
const POLL: Duration = Duration::from_millis(2);

pub struct Atoms {
    active: u32,
    moveresize: u32,
    change_state: u32,
}

impl Atoms {
    pub(super) fn intern(conn: &RustConnection) -> Result<Self, XError> {
        let atom = |name: &[u8]| -> Result<u32, XError> {
            Ok(conn
                .intern_atom(false, name)
                .map_err(x)?
                .reply()
                .map_err(x)?
                .atom)
        };
        Ok(Self {
            active: atom(b"_NET_ACTIVE_WINDOW")?,
            moveresize: atom(b"_NET_MOVERESIZE_WINDOW")?,
            change_state: atom(b"WM_CHANGE_STATE")?,
        })
    }
}

/// A frame edge as the 32-bit client-message field carries it: the float-to-int cast saturates,
/// and a negative edge travels as its two's complement.
fn edge(value: f64) -> u32 {
    value.round() as i32 as u32
}

impl InputConnection {
    pub(super) fn request(&self, window: Window, request: WmRequest) -> Result<(), XError> {
        let (kind, data) = match request {
            WmRequest::MoveResize(frame) => {
                let events =
                    ChangeWindowAttributesAux::new().event_mask(EventMask::STRUCTURE_NOTIFY);
                self.conn
                    .change_window_attributes(window, &events)
                    .map_err(x)?
                    .check()
                    .map_err(x)?;
                let flags = (0b1111 << 8) | (SOURCE_TOOL << 12);
                (
                    self.atoms.moveresize,
                    [
                        flags,
                        edge(frame.x),
                        edge(frame.y),
                        edge(frame.width),
                        edge(frame.height),
                    ],
                )
            }
            WmRequest::Iconify => (self.atoms.change_state, [ICONIC_STATE, 0, 0, 0, 0]),
            WmRequest::Activate => (self.atoms.active, [SOURCE_TOOL, CURRENT_TIME, 0, 0, 0]),
        };
        let event = ClientMessageEvent {
            response_type: CLIENT_MESSAGE_EVENT,
            format: 32,
            sequence: 0,
            window,
            type_: kind,
            data: ClientMessageData::from(data),
        };
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        self.conn
            .send_event(false, self.root, mask, event)
            .map_err(x)?
            .check()
            .map_err(x)
    }

    pub(super) fn root_frame(&self, window: Window) -> Result<Rect, XError> {
        let geometry = self
            .conn
            .get_geometry(window)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        let at = self
            .conn
            .translate_coordinates(window, self.root, 0, 0)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        Ok(Rect {
            x: f64::from(at.dst_x),
            y: f64::from(at.dst_y),
            width: f64::from(geometry.width),
            height: f64::from(geometry.height),
        })
    }

    /// Waits for `window`'s `ConfigureNotify`, then lets the manager's follow-up notifies land
    /// and reads the frame in root coordinates (the notify itself is parent-relative for a
    /// reparented client).
    pub(super) fn await_configure(
        &self,
        window: Window,
        wait: Duration,
    ) -> Result<Option<Rect>, XError> {
        let deadline = Instant::now() + wait;
        let mut settled_at: Option<Instant> = None;
        loop {
            let now = Instant::now();
            if settled_at.is_some_and(|at| now >= at) {
                return self.root_frame(window).map(Some);
            }
            if settled_at.is_none() && now >= deadline {
                return Ok(None);
            }
            match self.conn.poll_for_event().map_err(x)? {
                Some(Event::ConfigureNotify(notify)) if notify.window == window => {
                    settled_at.get_or_insert(now + SETTLE);
                }
                Some(_) => {}
                None => std::thread::sleep(POLL),
            }
        }
    }

    pub(super) fn client_evidence(&self, window: Window) -> Option<Evidence> {
        let wm_class = self.wm_class(window);
        let pid = self.local_pid(window).filter(|_| {
            self.local_pid(self.conn.setup().resource_id_base) == Some(std::process::id())
        });
        Some(
            pid.and_then(|pid| read_evidence(Path::new("/proc"), pid, wm_class.clone()))
                .unwrap_or(Evidence {
                    wm_class,
                    ..Evidence::default()
                }),
        )
    }

    /// The class part of the first `WM_CLASS` on the way from `window` up to the root.
    fn wm_class(&self, window: Window) -> String {
        let mut current = window;
        while current != self.root && current != x11rb::NONE {
            let class = self
                .conn
                .get_property(
                    false,
                    current,
                    AtomEnum::WM_CLASS,
                    AtomEnum::STRING,
                    0,
                    1024,
                )
                .ok()
                .and_then(|cookie| cookie.reply().ok())
                .map(|reply| reply.value)
                .filter(|value| !value.is_empty());
            if let Some(value) = class {
                let mut parts = value.split(|byte| *byte == 0);
                let instance = parts.next().unwrap_or_default();
                let class = parts
                    .next()
                    .filter(|class| !class.is_empty())
                    .unwrap_or(instance);
                return String::from_utf8_lossy(class).into_owned();
            }
            let Some(parent) = self
                .conn
                .query_tree(current)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
            else {
                break;
            };
            current = parent.parent;
        }
        String::new()
    }

    fn local_pid(&self, xid: u32) -> Option<u32> {
        let spec = ClientIdSpec {
            client: xid,
            mask: ClientIdMask::LOCAL_CLIENT_PID,
        };
        let reply = self.conn.res_query_client_ids(&[spec]).ok()?.reply().ok()?;
        reply
            .ids
            .iter()
            .find(|id| id.spec.mask == ClientIdMask::LOCAL_CLIENT_PID)?
            .value
            .first()
            .copied()
    }
}
