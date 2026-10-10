//! Pointer-state queries for the live X11 input connection: which windows
//! lie under the pointer, and whether another client holds it.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt as _, EventMask, GrabMode, GrabStatus, Window};
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use super::connection::failed;

/// Bounds the descent from the root; real window trees are far shallower.
const MAX_WINDOW_DEPTH: usize = 32;

/// Whether `window` is on the chain from the root down to the deepest
/// window under the pointer, as the server stacks them now.
pub(super) fn within(conn: &RustConnection, root: Window, window: Window) -> CoreResult<bool> {
    let mut current = root;
    for _ in 0..MAX_WINDOW_DEPTH {
        if current == window {
            return Ok(true);
        }
        let child = conn
            .query_pointer(current)
            .map_err(failed)?
            .reply()
            .map_err(failed)?
            .child;
        if child == x11rb::NONE {
            return Ok(false);
        }
        current = child;
    }
    Ok(false)
}

/// Whether another client holds the pointer: an active grab (a window
/// manager's activated button grab, or the implicit grab of a pressed
/// button) or a freeze. Probed with a grab that selects no events and is
/// released at once.
pub(super) fn held(conn: &RustConnection, root: Window) -> CoreResult<bool> {
    let status = conn
        .grab_pointer(
            false,
            root,
            EventMask::NO_EVENT,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
            x11rb::NONE,
            x11rb::NONE,
            CURRENT_TIME,
        )
        .map_err(failed)?
        .reply()
        .map_err(failed)?
        .status;
    match status {
        GrabStatus::SUCCESS => {
            conn.ungrab_pointer(CURRENT_TIME)
                .map_err(failed)?
                .check()
                .map_err(failed)?;
            conn.flush().map_err(failed)?;
            Ok(false)
        }
        GrabStatus::ALREADY_GRABBED | GrabStatus::FROZEN => Ok(true),
        other => Err(DesktopError::input_failed(format!(
            "X11 pointer grab probe was refused: {other:?}"
        ))),
    }
}
