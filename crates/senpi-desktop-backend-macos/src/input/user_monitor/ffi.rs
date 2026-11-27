//! The CoreGraphics and CoreFoundation declarations the watch's tap needs,
//! with the same signatures as `stop_path/tap.rs` declares them.

use std::ffi::c_void;

pub(super) type CfMachPortRef = *mut c_void;
pub(super) type CfRunLoopSourceRef = *mut c_void;
pub(super) type CfRunLoopRef = *mut c_void;
pub(super) type CfStringRef = *const c_void;
pub(super) type CgEventRef = *mut c_void;
pub(super) type CgEventTapProxy = *mut c_void;
pub(super) type CgEventTapCallBack =
    extern "C" fn(CgEventTapProxy, u32, CgEventRef, *mut c_void) -> CgEventRef;

pub(super) const ANNOTATED_SESSION_EVENT_TAP: u32 = 2; // kCGAnnotatedSessionEventTap
pub(super) const HEAD_INSERT: u32 = 0; // kCGHeadInsertEventTap
pub(super) const LISTEN_ONLY: u32 = 1; // kCGEventTapOptionListenOnly
pub(super) const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE; // kCGEventTapDisabledByTimeout
pub(super) const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF; // kCGEventTapDisabledByUserInput
pub(super) const TARGET_UNIX_PID_FIELD: u32 = 40; // kCGEventTargetUnixProcessID
pub(super) const SOURCE_UNIX_PID_FIELD: u32 = 41; // kCGEventSourceUnixProcessID
pub(super) const SOURCE_USER_DATA_FIELD: u32 = 42; // kCGEventSourceUserData

/// `CFRunLoopSourceContext`, version 0: only `perform` is set.
#[repr(C)]
pub(super) struct RunLoopSourceContext {
    pub(super) version: isize,
    pub(super) info: *mut c_void,
    pub(super) retain: Option<extern "C" fn(*const c_void) -> *const c_void>,
    pub(super) release: Option<extern "C" fn(*const c_void)>,
    pub(super) copy_description: Option<extern "C" fn(*const c_void) -> *const c_void>,
    pub(super) equal: Option<extern "C" fn(*const c_void, *const c_void) -> u8>,
    pub(super) hash: Option<extern "C" fn(*const c_void) -> usize>,
    pub(super) schedule: Option<extern "C" fn(*mut c_void, CfRunLoopRef, CfStringRef)>,
    pub(super) cancel: Option<extern "C" fn(*mut c_void, CfRunLoopRef, CfStringRef)>,
    pub(super) perform: Option<extern "C" fn(*mut c_void)>,
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    pub(super) fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CgEventTapCallBack,
        user_info: *mut c_void,
    ) -> CfMachPortRef;
    pub(super) fn CGEventTapEnable(tap: CfMachPortRef, enable: bool);
    pub(super) fn CGEventGetIntegerValueField(event: CgEventRef, field: u32) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub(super) static kCFRunLoopDefaultMode: CfStringRef;
    pub(super) fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CfMachPortRef,
        order: isize,
    ) -> CfRunLoopSourceRef;
    pub(super) fn CFMachPortInvalidate(port: CfMachPortRef);
    pub(super) fn CFRunLoopGetCurrent() -> CfRunLoopRef;
    pub(super) fn CFRunLoopAddSource(
        run_loop: CfRunLoopRef,
        source: CfRunLoopSourceRef,
        mode: CfStringRef,
    );
    pub(super) fn CFRunLoopRemoveSource(
        run_loop: CfRunLoopRef,
        source: CfRunLoopSourceRef,
        mode: CfStringRef,
    );
    pub(super) fn CFRunLoopRun();
    pub(super) fn CFRunLoopStop(run_loop: CfRunLoopRef);
    pub(super) fn CFRunLoopWakeUp(run_loop: CfRunLoopRef);
    pub(super) fn CFRunLoopSourceCreate(
        allocator: *const c_void,
        order: isize,
        context: *mut RunLoopSourceContext,
    ) -> CfRunLoopSourceRef;
    pub(super) fn CFRunLoopSourceSignal(source: CfRunLoopSourceRef);
    pub(super) fn CFRetain(cf: *const c_void) -> *const c_void;
    pub(super) fn CFRelease(cf: *const c_void);
}
