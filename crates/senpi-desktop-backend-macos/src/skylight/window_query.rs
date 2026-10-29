//! WindowServer's window relationships through the SkyLight window query:
//! the parent a sheet, panel or inline-editor overlay is attached to, and the
//! process that owns a window, including windows a remote-view service keeps
//! off the window list (ported from oh-my-pi 0838d2ab44 `window_parent`,
//! `window_owner_pid`).

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::LazyLock;

use objc2_core_foundation::{CFArray, CFNumber, CFRetained, CFType};

use super::spi::{ensure_skylight_loaded, symbol, CGSMainConnectionIDFn, SLSGetWindowOwnerFn};

type SLSWindowQueryWindowsFn = unsafe extern "C" fn(i32, *const c_void, u32) -> *mut CFType;
type SLSWindowQueryResultCopyWindowsFn = unsafe extern "C" fn(&CFType) -> *mut CFType;
type SLSWindowIteratorAdvanceFn = unsafe extern "C" fn(&CFType) -> bool;
type SLSWindowIteratorGetIdFn = unsafe extern "C" fn(&CFType) -> u32;
type SLSConnectionGetPIDFn = unsafe extern "C" fn(u32, *mut libc::pid_t) -> i32;

#[derive(Clone, Copy)]
struct WindowQuerySpi {
    connection: CGSMainConnectionIDFn,
    query: SLSWindowQueryWindowsFn,
    windows: SLSWindowQueryResultCopyWindowsFn,
    advance: SLSWindowIteratorAdvanceFn,
    window_id: SLSWindowIteratorGetIdFn,
    parent_id: SLSWindowIteratorGetIdFn,
}

static WINDOW_QUERY: LazyLock<Option<WindowQuerySpi>> = LazyLock::new(|| {
    ensure_skylight_loaded()?;
    Some(WindowQuerySpi {
        connection: symbol(c"CGSMainConnectionID")?,
        query: symbol(c"SLSWindowQueryWindows")?,
        windows: symbol(c"SLSWindowQueryResultCopyWindows")?,
        advance: symbol(c"SLSWindowIteratorAdvance")?,
        window_id: symbol(c"SLSWindowIteratorGetWindowID")?,
        parent_id: symbol(c"SLSWindowIteratorGetParentID")?,
    })
});

/// The window `wid` is a child of in WindowServer, such as the window a
/// sheet or an inline editor's overlay is attached to; `None` for a
/// top-level window or when the query is unavailable.
pub(crate) fn window_parent(wid: u32) -> Option<u32> {
    let spi = WINDOW_QUERY.as_ref()?;
    let number = CFNumber::new_i64(i64::from(wid));
    let windows = CFArray::from_objects(&[&*number]);
    // SAFETY: The no-argument connection query has its exact signature.
    let connection = unsafe { (spi.connection)() } as i32;
    // SAFETY: `windows` holds one CFNumber window id and outlives the call;
    // the result is a create-rule object or null.
    let query = retained(unsafe { (spi.query)(connection, (&*windows as *const CFArray<CFNumber>).cast(), 0) })?;
    // SAFETY: `query` is a live window query; the result is create-rule or null.
    let iterator = retained(unsafe { (spi.windows)(&query) })?;
    // SAFETY: `iterator` stays retained across every iterator call.
    while unsafe { (spi.advance)(&iterator) } {
        // SAFETY: As above; the iterator was advanced onto a window.
        if unsafe { (spi.window_id)(&iterator) } == wid {
            // SAFETY: As above.
            return Some(unsafe { (spi.parent_id)(&iterator) }).filter(|&parent| parent != 0);
        }
    }
    None
}

#[derive(Clone, Copy)]
struct WindowOwnerSpi {
    connection: CGSMainConnectionIDFn,
    owner: SLSGetWindowOwnerFn,
    pid: SLSConnectionGetPIDFn,
}

static WINDOW_OWNER: LazyLock<Option<WindowOwnerSpi>> = LazyLock::new(|| {
    ensure_skylight_loaded()?;
    Some(WindowOwnerSpi {
        connection: symbol(c"CGSMainConnectionID")?,
        owner: symbol(c"SLSGetWindowOwner")?,
        pid: symbol(c"SLSConnectionGetPID")?,
    })
});

/// The process that owns window `wid` in WindowServer, including the
/// windows a remote-view service keeps off the window list, such as the one
/// `openAndSavePanelService` draws an application's Open panel in.
pub(crate) fn window_owner_pid(wid: u32) -> Option<libc::pid_t> {
    let spi = WINDOW_OWNER.as_ref()?;
    let mut owner = 0u32;
    // SAFETY: The connection query takes no arguments, and `owner` is
    // writable for the exact window-owner signature.
    if unsafe { (spi.owner)((spi.connection)(), wid, &mut owner) } != 0 || owner == 0 {
        return None;
    }
    let mut pid: libc::pid_t = 0;
    // SAFETY: `pid` is writable for the exact connection-pid signature.
    (unsafe { (spi.pid)(owner, &mut pid) } == 0 && pid > 0).then_some(pid)
}

/// Takes ownership of a create-rule `CFType` pointer, which may be null.
fn retained(pointer: *mut CFType) -> Option<CFRetained<CFType>> {
    // SAFETY: Every caller passes the +1 result of a copy or create call.
    NonNull::new(pointer).map(|pointer| unsafe { CFRetained::from_raw(pointer) })
}
