//! Keyboard-event authentication: Chromium and hardened apps only accept
//! background keystrokes whose event carries an `SLSEventAuthenticationMessage`
//! (macOS 15+ factory; harmless no-op where the class or selector is absent).

use std::ffi::c_void;
use std::ptr;

use core_graphics::event::CGEvent;
use foreign_types::ForeignType;

use super::spi::AUTHENTICATION;

/// `__CGEvent` stores its `SLSEventRecord` pointer after `CFRuntimeBase` and a
/// padded `u32`; these are the known pointer-aligned candidate slots.
const EVENT_RECORD_OFFSETS: [usize; 3] = [24, 32, 16];

pub(super) fn attach_keyboard_authentication(pid: libc::pid_t, event: &CGEvent) {
    let Some(spi) = AUTHENTICATION.as_ref() else {
        return;
    };
    // SAFETY: Both C strings are static; runtime lookup functions have their
    // exact Objective-C ABI.
    let class = unsafe { (spi.objc_get_class)(c"SLSEventAuthenticationMessage".as_ptr()) };
    // SAFETY: The selector C string is static and NUL-terminated.
    let selector = unsafe { (spi.sel_register_name)(c"messageWithEventRecord:pid:version:".as_ptr()) };
    if class.is_null() || selector.is_null() {
        return;
    }
    // SAFETY: This guard is required because macOS 14 has the class but lacks
    // the macOS 15+ factory selector.
    if !unsafe { (spi.class_responds)(class, selector) } {
        return;
    }
    let event_raw = event.as_ptr().cast::<c_void>();
    let mut record = ptr::null_mut();
    for offset in EVENT_RECORD_OFFSETS {
        // SAFETY: Reading a pointer-sized candidate slot through
        // `read_unaligned` makes no alignment assumption about `__CGEvent`.
        let candidate =
            unsafe { ptr::read_unaligned(event_raw.cast::<u8>().add(offset).cast::<*mut c_void>()) };
        if !candidate.is_null() {
            record = candidate;
            break;
        }
    }
    if record.is_null() {
        return;
    }
    // SAFETY: Class response was checked before invoking this exact factory
    // signature.
    let message = unsafe { (spi.factory)(class, selector, record, pid, 0) };
    if message.is_null() {
        return;
    }
    // SAFETY: The event and autoreleased authentication object are alive for
    // the synchronous attachment.
    unsafe { (spi.set_message)(event_raw, message) };
}
