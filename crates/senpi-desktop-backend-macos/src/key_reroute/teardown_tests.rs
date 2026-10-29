use std::ffi::c_void;
use std::ptr;

use super::ffi::{ConstRef, Ref};
use super::worker::{ExitPort, Tap};

#[repr(C)]
struct Context {
    version: isize,
    info: Ref,
    retain: Option<unsafe extern "C" fn(ConstRef) -> ConstRef>,
    release: Option<unsafe extern "C" fn(ConstRef)>,
    description: Option<unsafe extern "C" fn(ConstRef) -> ConstRef>,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFMachPortCreate(
        allocator: ConstRef,
        callback: unsafe extern "C" fn(Ref, Ref, isize, Ref),
        context: *mut Context,
        should_free: *mut u8,
    ) -> Ref;
    fn CFMachPortIsValid(port: Ref) -> u8;
}

unsafe extern "C" fn receive(_: Ref, _: Ref, _: isize, _: Ref) {}

fn port() -> Tap {
    let mut context = Context {
        version: 0,
        info: ptr::null_mut::<c_void>(),
        retain: None,
        release: None,
        description: None,
    };
    let mut should_free = 0;
    // SAFETY: Version-zero context with no user pointer; this test sends no
    // messages and CoreFoundation copies the context synchronously.
    let port = unsafe { CFMachPortCreate(ptr::null(), receive, &mut context, &mut should_free) };
    assert!(!port.is_null());
    Tap(port)
}

#[test]
fn exit_hooks_invalidate_both_real_mach_ports_before_context_teardown() {
    let focus = port();
    let key = port();
    let focus_exit = ExitPort::retain(&focus);
    let key_exit = ExitPort::retain(&key);
    let registration = crate::exit_safety::register(move || {
        focus_exit.invalidate();
        key_exit.invalidate();
    });
    // SAFETY: Both create-rule references are still live.
    assert_ne!(unsafe { CFMachPortIsValid(focus.0) }, 0);
    assert_ne!(unsafe { CFMachPortIsValid(key.0) }, 0);
    registration();
    // SAFETY: Invalidating a retained port does not release it.
    assert_eq!(unsafe { CFMachPortIsValid(focus.0) }, 0);
    assert_eq!(unsafe { CFMachPortIsValid(key.0) }, 0);
    registration();
    drop(registration);
    // The worker's create-rule references are still valid to release once.
    drop(key);
    drop(focus);
}
