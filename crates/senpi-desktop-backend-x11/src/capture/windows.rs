//! EWMH client enumeration: `_NET_CLIENT_LIST_STACKING` (fallback
//! `_NET_CLIENT_LIST`), topmost first, with `_NET_ACTIVE_WINDOW` as focus.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;
use x11rb::protocol::xproto::{Atom, AtomEnum, Window};

use super::connection::{Placement, XServer};

pub(crate) const MAX_WINDOWS: usize = 48;
pub(crate) const MIN_WINDOW_EDGE: u32 = 16;

/// One enumeration pass: the interned atoms and the active window.
struct Enumeration<'s, S> {
    server: &'s S,
    name: Atom,
    utf8: Atom,
    state: Atom,
    hidden: Atom,
    pid: Atom,
    active: Option<Window>,
}

/// Viewable, non-hidden client windows of at least `MIN_WINDOW_EDGE` that
/// intersect the root, topmost first, capped at `MAX_WINDOWS`. A window that
/// disappears mid-enumeration is skipped, never an error.
pub(crate) fn windows(server: &impl XServer) -> CoreResult<Vec<DesktopWindow>> {
    let screen = server.screen();
    let window_kind = Atom::from(AtomEnum::WINDOW);
    let stacking = server.atom("_NET_CLIENT_LIST_STACKING")?;
    let fallback = server.atom("_NET_CLIENT_LIST")?;
    let Some(mut ids) = server
        .words(screen.root, stacking, window_kind)
        .or_else(|| server.words(screen.root, fallback, window_kind))
    else {
        return Ok(Vec::new());
    };
    ids.reverse();
    let pass = Enumeration {
        server,
        active: active_window(server)?,
        name: server.atom("_NET_WM_NAME")?,
        utf8: server.atom("UTF8_STRING")?,
        state: server.atom("_NET_WM_STATE")?,
        hidden: server.atom("_NET_WM_STATE_HIDDEN")?,
        pid: server.atom("_NET_WM_PID")?,
    };
    let mut windows = Vec::with_capacity(ids.len().min(MAX_WINDOWS));
    for id in ids {
        if windows.len() == MAX_WINDOWS {
            break;
        }
        let Some(placement) = server.placement(id) else {
            continue;
        };
        if !visible_on_root(placement, screen.width, screen.height) || pass.is_hidden(id) {
            continue;
        }
        windows.push(pass.describe(id, placement));
    }
    Ok(windows)
}

/// The EWMH `_NET_ACTIVE_WINDOW`, when the window manager publishes one.
fn active_window(server: &impl XServer) -> CoreResult<Option<Window>> {
    let atom = server.atom("_NET_ACTIVE_WINDOW")?;
    Ok(server
        .words(server.screen().root, atom, AtomEnum::WINDOW.into())
        .and_then(|words| words.first().copied())
        .filter(|&window| window != 0))
}

fn visible_on_root(placement: Placement, root_width: u32, root_height: u32) -> bool {
    let (x, y) = (i64::from(placement.x), i64::from(placement.y));
    placement.viewable
        && placement.width >= MIN_WINDOW_EDGE
        && placement.height >= MIN_WINDOW_EDGE
        && x < i64::from(root_width)
        && y < i64::from(root_height)
        && x + i64::from(placement.width) > 0
        && y + i64::from(placement.height) > 0
}

impl<S: XServer> Enumeration<'_, S> {
    fn is_hidden(&self, id: Window) -> bool {
        self.server
            .words(id, self.state, AtomEnum::ATOM.into())
            .is_some_and(|states| states.contains(&self.hidden))
    }

    fn describe(&self, id: Window, placement: Placement) -> DesktopWindow {
        let title = self
            .server
            .bytes(id, self.name, self.utf8)
            .or_else(|| {
                self.server
                    .bytes(id, AtomEnum::WM_NAME.into(), AtomEnum::ANY.into())
            })
            .map(|value| String::from_utf8_lossy(&value).into_owned())
            .unwrap_or_default();
        let app = self
            .server
            .bytes(id, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into())
            .map(|value| parse_wm_class(&value))
            .unwrap_or_default();
        let pid = self
            .server
            .words(id, self.pid, AtomEnum::CARDINAL.into())
            .and_then(|words| words.first().copied());
        DesktopWindow {
            id: id.to_string(),
            title,
            app,
            pid,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            focused: self.active == Some(id),
            elevated: None,
        }
    }
}

/// `WM_CLASS` is `instance\0class\0`; the class names the application.
pub(crate) fn parse_wm_class(value: &[u8]) -> String {
    let mut parts = value.split(|&byte| byte == 0).filter(|part| !part.is_empty());
    let instance = parts.next();
    parts
        .next()
        .or(instance)
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .unwrap_or_default()
}
