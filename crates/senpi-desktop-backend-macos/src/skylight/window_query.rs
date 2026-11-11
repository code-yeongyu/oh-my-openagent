//! `WindowServer`'s window parents: the window a sheet, popover or inline
//! editor's overlay is attached to (ported from oh-my-pi 18.13.1
//! `macos/skylight.rs` `window_parent`).

use std::ptr::NonNull;
use std::sync::LazyLock;

use objc2_core_foundation::{CFArray, CFNumber, CFRetained, CFType};

use super::spi::{ensure_skylight_loaded, symbol};

type MainConnectionFn = unsafe extern "C" fn() -> u32;
type QueryWindowsFn = unsafe extern "C" fn(i32, &CFArray, u32) -> *mut CFType;
type CopyWindowsFn = unsafe extern "C" fn(&CFType) -> *mut CFType;
type AdvanceFn = unsafe extern "C" fn(&CFType) -> bool;
type IteratorIdFn = unsafe extern "C" fn(&CFType) -> u32;

struct WindowQuerySpi {
    connection: MainConnectionFn,
    query: QueryWindowsFn,
    windows: CopyWindowsFn,
    advance: AdvanceFn,
    window_id: IteratorIdFn,
    parent_id: IteratorIdFn,
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

/// The window `wid` is a child of, such as the window a sheet or an inline
/// editor's overlay is attached to; `None` for a top-level window or when the
/// query is unavailable.
pub(crate) fn window_parent(wid: u32) -> Option<u32> {
    let spi = WINDOW_QUERY.as_ref()?;
    let number = CFNumber::new_i64(i64::from(wid));
    let windows = CFArray::from_objects(&[&*number]);
    // SAFETY: The no-argument connection query was resolved with its exact
    // signature; the id is a small positive connection number.
    let connection = unsafe { (spi.connection)() }.cast_signed();
    // SAFETY: `windows` holds one CFNumber window id and outlives the call; the
    // result is a create-rule object or null.
    let query = retained(unsafe { (spi.query)(connection, windows.as_opaque(), 0) })?;
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

/// Takes ownership of a create-rule `CFType` pointer, which may be null.
fn retained(pointer: *mut CFType) -> Option<CFRetained<CFType>> {
    // SAFETY: Every caller passes the +1 result of a copy or create call.
    NonNull::new(pointer).map(|pointer| unsafe { CFRetained::from_raw(pointer) })
}
