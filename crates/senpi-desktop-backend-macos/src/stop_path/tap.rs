//! One listen-only `CGEventTap` lifetime on the listener thread's
//! `CFRunLoop`: create, register, beat while enabled, tear down.

use std::cell::Cell;
use std::ffi::c_void;
use std::ptr;
use std::time::Duration;

use senpi_desktop_safety::HEARTBEAT_INTERVAL_MS;

use super::Shared;

type CfMachPortRef = *mut c_void;
type CfRunLoopSourceRef = *mut c_void;
type CfRunLoopRef = *mut c_void;
type CfStringRef = *const c_void;
type CgEventRef = *mut c_void;
type CgEventTapProxy = *mut c_void;
type CgEventTapCallBack = extern "C" fn(CgEventTapProxy, u32, CgEventRef, *mut c_void) -> CgEventRef;

const SESSION_EVENT_TAP: u32 = 1; // kCGSessionEventTap
const HEAD_INSERT: u32 = 0; // kCGHeadInsertEventTap
const LISTEN_ONLY: u32 = 1; // kCGEventTapOptionListenOnly
pub(super) const EVENT_KEY_DOWN: u32 = 10; // kCGEventKeyDown
const KEYCODE_FIELD: u32 = 9; // kCGKeyboardEventKeycode
const KEY_DOWN_MASK: u64 = 1 << EVENT_KEY_DOWN;
pub(super) const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE; // kCGEventTapDisabledByTimeout
pub(super) const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF; // kCGEventTapDisabledByUserInput
pub(super) const RUN_LOOP_TIMED_OUT: i32 = 3; // kCFRunLoopRunTimedOut
pub(super) const RUN_LOOP_HANDLED_SOURCE: i32 = 4; // kCFRunLoopRunHandledSource

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CgEventTapCallBack,
        user_info: *mut c_void,
    ) -> CfMachPortRef;
    fn CGEventTapEnable(tap: CfMachPortRef, enable: bool);
    fn CGEventTapIsEnabled(tap: CfMachPortRef) -> bool;
    fn CGEventGetIntegerValueField(event: CgEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CgEventRef) -> u64;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopCommonModes: CfStringRef;
    static kCFRunLoopDefaultMode: CfStringRef;
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CfMachPortRef,
        order: isize,
    ) -> CfRunLoopSourceRef;
    fn CFMachPortInvalidate(port: CfMachPortRef);
    fn CFRunLoopGetCurrent() -> CfRunLoopRef;
    fn CFRunLoopAddSource(run_loop: CfRunLoopRef, source: CfRunLoopSourceRef, mode: CfStringRef);
    fn CFRunLoopRemoveSource(run_loop: CfRunLoopRef, source: CfRunLoopSourceRef, mode: CfStringRef);
    fn CFRunLoopRunInMode(mode: CfStringRef, seconds: f64, return_after_source_handled: bool) -> i32;
    fn CFRelease(cf: *const c_void);
}

/// How one tap lifetime ended.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TapRun {
    /// No tap came up; nothing was live.
    CreateFailed,
    /// The tap was live, then died or stayed disabled.
    Died,
    /// The owner dropped the listener.
    Shutdown,
}

/// What the callback does with one tap event.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TapAction {
    ReEnable,
    KeyDown,
    PassThrough,
}

pub(super) const fn classify(event_type: u32) -> TapAction {
    match event_type {
        TAP_DISABLED_BY_TIMEOUT | TAP_DISABLED_BY_USER_INPUT => TapAction::ReEnable,
        EVENT_KEY_DOWN => TapAction::KeyDown,
        _ => TapAction::PassThrough,
    }
}

/// A heartbeat step keeps the path live only when the run loop is still
/// servicing the tap and the tap is enabled.
pub(super) const fn listener_step_is_live(run_loop_result: i32, tap_enabled: bool) -> bool {
    matches!(run_loop_result, RUN_LOOP_TIMED_OUT | RUN_LOOP_HANDLED_SOURCE) && tap_enabled
}

/// What the callback reaches through `user_info`.
struct TapContext<'a> {
    shared: &'a Shared,
    tap: Cell<CfMachPortRef>,
}

extern "C" fn tap_callback(
    _proxy: CgEventTapProxy,
    event_type: u32,
    event: CgEventRef,
    user_info: *mut c_void,
) -> CgEventRef {
    // SAFETY: [use-after-free] `user_info` is the `TapContext` of `run`, which
    // outlives the registration: `Registered` removes the source and
    // invalidates the port before the context drops, and the tap calls back
    // only from this thread's `CFRunLoopRunInMode`.
    let context = unsafe { &*user_info.cast::<TapContext<'_>>() };
    match classify(event_type) {
        TapAction::ReEnable => {
            // SAFETY: [FFI] the port is live while its callback runs.
            unsafe { CGEventTapEnable(context.tap.get(), true) };
        }
        TapAction::KeyDown if !event.is_null() => {
            // SAFETY: [FFI] `event` is the non-null key-down handed to this
            // callback; it is only read.
            let keycode = unsafe { CGEventGetIntegerValueField(event, KEYCODE_FIELD) };
            // SAFETY: [FFI] as above.
            let flags = unsafe { CGEventGetFlags(event) };
            context.shared.key_down(keycode, flags);
        }
        TapAction::KeyDown | TapAction::PassThrough => {}
    }
    // Listen-only: the event passes through untouched.
    event
}

/// A CF object created here and released once on drop.
struct CfOwned(*mut c_void);

impl Drop for CfOwned {
    fn drop(&mut self) {
        // SAFETY: [double free] the pointer came from a CF `Create` call and
        // this guard is its only release.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

/// The tap's source on this thread's run loop. Dropping it unregisters the
/// source and invalidates the port, so no callback can reach a dropped
/// `TapContext`.
struct Registered {
    run_loop: CfRunLoopRef,
    source: CfRunLoopSourceRef,
    tap: CfMachPortRef,
}

impl Drop for Registered {
    fn drop(&mut self) {
        // SAFETY: [FFI] the source was added to this run loop in this mode.
        unsafe { CFRunLoopRemoveSource(self.run_loop, self.source, kCFRunLoopCommonModes) };
        // SAFETY: [FFI] the port is still retained by its `CfOwned`.
        unsafe { CFMachPortInvalidate(self.tap) };
    }
}

/// Runs one tap until it dies or the owner shuts the listener down; marks
/// the `Global` path live only while the tap is enabled.
pub(super) fn run(shared: &Shared) -> TapRun {
    let context = TapContext {
        shared,
        tap: Cell::new(ptr::null_mut()),
    };
    let user_info = ptr::from_ref(&context).cast_mut().cast::<c_void>();
    // SAFETY: [FFI] a listen-only key-down session tap; `user_info` points at
    // `context`, declared before every guard below and so dropped after them.
    let tap = unsafe {
        CGEventTapCreate(
            SESSION_EVENT_TAP,
            HEAD_INSERT,
            LISTEN_ONLY,
            KEY_DOWN_MASK,
            tap_callback,
            user_info,
        )
    };
    if tap.is_null() {
        shared.tap_failed();
        return TapRun::CreateFailed;
    }
    let _tap = CfOwned(tap);
    context.tap.set(tap);
    // SAFETY: [FFI] `tap` is the live port just created.
    let source = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), tap, 0) };
    if source.is_null() {
        shared.tap_failed();
        return TapRun::CreateFailed;
    }
    let _source = CfOwned(source);
    // SAFETY: [FFI] returns this thread's run loop; no arguments.
    let run_loop = unsafe { CFRunLoopGetCurrent() };
    // SAFETY: [FFI] live run loop, live source, CF-provided mode constant.
    unsafe { CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes) };
    let _registered = Registered {
        run_loop,
        source,
        tap,
    };
    // SAFETY: [FFI] `tap` is live.
    unsafe { CGEventTapEnable(tap, true) };
    // SAFETY: [FFI] `tap` is live.
    if !unsafe { CGEventTapIsEnabled(tap) } {
        shared.tap_failed();
        return TapRun::CreateFailed;
    }
    shared.set_live(true);
    let seconds = Duration::from_millis(HEARTBEAT_INTERVAL_MS).as_secs_f64();
    let exit = loop {
        // SAFETY: [FFI] runs this thread's loop in the default mode, which
        // `kCFRunLoopCommonModes` includes, for one heartbeat interval.
        let result = unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds, false) };
        #[cfg(test)]
        let simulated = hooks::apply(&context, user_info);
        if shared.shutdown_requested() {
            break TapRun::Shutdown;
        }
        // SAFETY: [FFI] `tap` is live.
        let live = listener_step_is_live(result, unsafe { CGEventTapIsEnabled(tap) });
        #[cfg(test)]
        hooks::record(shared, simulated, live);
        if !live {
            break TapRun::Died;
        }
        shared.heartbeat();
    };
    shared.set_live(false);
    exit
}

#[cfg(test)]
pub(super) use hooks::{Simulate, TestHooks};

/// Live-test hooks that make the OS-side tap failures happen on demand, on
/// the tap thread itself.
#[cfg(test)]
mod hooks {
    use std::ffi::c_void;
    use std::ptr;

    use super::{tap_callback, CGEventTapEnable, Shared, TapContext, TAP_DISABLED_BY_TIMEOUT};

    #[derive(Debug, Clone, Copy)]
    pub(in crate::stop_path) enum Simulate {
        /// The OS disables the tap and tells the callback it timed out.
        DisabledByTimeout,
        /// The tap is disabled and stays so.
        Disabled,
    }

    #[derive(Debug, Default)]
    pub(in crate::stop_path) struct TestHooks {
        pub(in crate::stop_path) simulate: Option<Simulate>,
        /// Whether the step right after the last simulation stayed live.
        pub(in crate::stop_path) simulated_step_live: Option<bool>,
        /// Times a tap went live.
        pub(in crate::stop_path) went_live: u64,
    }

    pub(super) fn apply(context: &TapContext<'_>, user_info: *mut c_void) -> bool {
        let Some(simulate) = context.shared.control.lock().hooks.simulate.take() else {
            return false;
        };
        // SAFETY: [FFI] called on the tap thread while `run` holds the port.
        unsafe { CGEventTapEnable(context.tap.get(), false) };
        match simulate {
            Simulate::DisabledByTimeout => {
                tap_callback(
                    ptr::null_mut(),
                    TAP_DISABLED_BY_TIMEOUT,
                    ptr::null_mut(),
                    user_info,
                );
            }
            Simulate::Disabled => {}
        }
        true
    }

    pub(super) fn record(shared: &Shared, simulated: bool, live: bool) {
        if simulated {
            shared.update(|control| control.hooks.simulated_step_live = Some(live));
        }
    }
}
