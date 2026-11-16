//! The client behind a window, for the background-input check: its local
//! process id comes from the X server itself (X-Resource `LocalClientPID`),
//! never from the client-written `_NET_WM_PID`, which a remote or sandboxed
//! client fills with a pid that names another process here.

use std::path::Path;

use x11rb::connection::Connection;
use x11rb::protocol::res::{ClientIdMask, ClientIdSpec, ConnectionExt as _};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, Window};
use x11rb::rust_connection::RustConnection;

use super::client_process::ClientProcess;

/// Upper bound on the `RESOURCE_MANAGER` read, in 32-bit units (256 KiB).
const RESOURCE_MANAGER_LIMIT: u32 = 64 * 1024;

/// What `/proc` shows about the local client that owns `window`.
///
/// # Errors
/// Why the client is unknown: X-Resource is missing, the server knows no
/// local pid (a remote client), or the process cannot be read.
pub(super) fn client_process(conn: &RustConnection, window: Window) -> Result<ClientProcess, String> {
    let window_pid = local_pid(conn, window)?;
    let own_pid_seen = local_pid(conn, conn.setup().resource_id_base)?;
    let pid = trusted_pid(window_pid, own_pid_seen, std::process::id())?;
    ClientProcess::read(Path::new("/proc"), pid)
}

/// The pid of the window's client as the X server sees it, given the pid it
/// sees for this engine's own connection (`own_pid_seen`) and this engine's
/// pid (`own_pid`).
///
/// # Errors
/// Why the pid cannot be used against this engine's `/proc`.
pub(super) fn trusted_pid(window_pid: Option<u32>, _own_pid_seen: Option<u32>, _own_pid: u32) -> Result<u32, String> {
    window_pid.ok_or_else(|| "the X server knows no local process for the window's client".to_owned())
}

/// The `LocalClientPID` of the client owning resource `xid` (any XID in the
/// client's range names it), or `None` when the server knows none.
fn local_pid(conn: &RustConnection, xid: u32) -> Result<Option<u32>, String> {
    let spec = ClientIdSpec {
        client: xid,
        mask: ClientIdMask::LOCAL_CLIENT_PID,
    };
    let reply = conn
        .res_query_client_ids(&[spec])
        .map_err(|error| format!("the X-Resource extension is unavailable ({error})"))?
        .reply()
        .map_err(|error| format!("the X server did not name the window's client ({error})"))?;
    Ok(reply
        .ids
        .iter()
        .find(|id| id.spec.mask == ClientIdMask::LOCAL_CLIENT_PID)
        .and_then(|id| id.value.first().copied()))
}

/// The root window's `RESOURCE_MANAGER` database; empty when unset.
pub(super) fn resources(conn: &RustConnection, root: Window) -> Vec<u8> {
    conn.get_property(
        false,
        root,
        AtomEnum::RESOURCE_MANAGER,
        AtomEnum::STRING,
        0,
        RESOURCE_MANAGER_LIMIT,
    )
    .ok()
    .and_then(|cookie| cookie.reply().ok())
    .map(|reply| reply.value)
    .unwrap_or_default()
}
