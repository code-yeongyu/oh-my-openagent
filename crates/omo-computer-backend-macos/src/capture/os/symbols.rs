//! The per-symbol probe of private frameworks: an unresolved symbol is `None`, never a crash.

use std::ffi::{c_void, CStr};
use std::sync::OnceLock;

const SKYLIGHT: &CStr = c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight";

struct Handle(*mut c_void);

// SAFETY: a dlopen handle is process-global and immutable once opened.
unsafe impl Send for Handle {}
// SAFETY: as above.
unsafe impl Sync for Handle {}

fn skylight() -> *mut c_void {
    static HANDLE: OnceLock<Handle> = OnceLock::new();
    // SAFETY: a constant path; a failed open is a null handle and every lookup then reads None.
    HANDLE
        .get_or_init(|| Handle(unsafe { libc::dlopen(SKYLIGHT.as_ptr(), libc::RTLD_LAZY) }))
        .0
}

/// The function `name` from SkyLight or the process image, as `F` (a fn pointer type whose
/// signature the caller states); `None` when it does not resolve.
pub fn lookup<F: Copy>(name: &CStr) -> Option<F> {
    assert_eq!(std::mem::size_of::<F>(), std::mem::size_of::<*mut c_void>());
    let handle = skylight();
    // SAFETY: `name` is NUL-terminated; dlsym on a null handle is never called.
    let mut symbol = if handle.is_null() {
        std::ptr::null_mut()
    } else {
        unsafe { libc::dlsym(handle, name.as_ptr()) }
    };
    if symbol.is_null() {
        // SAFETY: as above, on the default search scope.
        symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    }
    // SAFETY: a non-null symbol reinterpreted as the pointer-sized fn type the caller names.
    (!symbol.is_null()).then(|| unsafe { std::mem::transmute_copy::<*mut c_void, F>(&symbol) })
}
