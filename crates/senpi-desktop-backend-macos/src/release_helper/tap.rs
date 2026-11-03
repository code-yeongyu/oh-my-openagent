//! The helper's listen-only session tap: it follows what the user physically
//! holds on the HID route, so a release the user's own hold still covers is
//! left to them. Ported from oh-my-pi `desktop/macos/release_helper.rs`
//! (MIT).

use std::ffi::c_void;
use std::io::Write;
use std::os::unix::net::UnixStream;
use std::ptr;
use std::sync::{Arc, Mutex, PoisonError};

use super::holds::{transition, Transition, UserHolds, TRANSITION_TYPES};
use super::observe::{Observation, Transitions};
use super::wire::{Input, READY};

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
const KEYCODE_FIELD: u32 = 9; // kCGKeyboardEventKeycode
const BUTTON_NUMBER_FIELD: u32 = 3; // kCGMouseEventButtonNumber
const SOURCE_UNIX_PID_FIELD: u32 = 41; // kCGEventSourceUnixProcessID
const TAP_DISABLED: [u32; 2] = [0xFFFF_FFFE, 0xFFFF_FFFF];
const HID_SYSTEM_STATE: i32 = 1; // kCGEventSourceStateHIDSystemState
const RUN_LOOP_HANDLED_SOURCE: i32 = 4; // kCFRunLoopRunHandledSource
const BRIEFLY_SECONDS: f64 = 0.05;

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
    fn CGEventGetIntegerValueField(event: CgEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CgEventRef) -> u64;
    fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
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
    fn CFRunLoopRunInMode(mode: CfStringRef, seconds: f64, return_after_source_handled: bool) -> i32;
}

/// The helper's tap. When a process dies with a listen-only tap still valid
/// while the user types, the window server can deliver the key the tap was
/// routing a second time, so the helper closes it before it exits.
static TAP: Mutex<TapState> = Mutex::new(TapState::Unstarted);

enum TapState {
    Unstarted,
    Running(Port),
    /// No tap starts once the helper has closed it.
    Closed,
}

struct Port(CfMachPortRef);

// SAFETY: [data race] a `CFMachPort` may be invalidated from any thread, and
// the port is never released, so the pointer stays valid for the process.
unsafe impl Send for Port {}

/// Invalidates the tap if it runs, and keeps one from starting.
pub(crate) fn close() {
    let mut tap = TAP.lock().unwrap_or_else(PoisonError::into_inner);
    if let TapState::Running(Port(port)) = std::mem::replace(&mut *tap, TapState::Closed) {
        // SAFETY: [FFI] the port is live: it is never released.
        unsafe { CFMachPortInvalidate(port) };
    }
}

/// What the callback reaches through `user_info`; leaked for the process.
struct Context {
    observation: Arc<Observation>,
    port: CfMachPortRef,
}

struct RunLoop;

impl Transitions for RunLoop {
    fn drain(&self) {
        // SAFETY: [FFI] runs this thread's loop without waiting; the tap queues
        // only key and button transitions, far slower than this applies them.
        while unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.0, true) } == RUN_LOOP_HANDLED_SOURCE {}
    }

    fn run_briefly(&self) {
        // SAFETY: [FFI] runs this thread's loop for a bounded interval.
        unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, BRIEFLY_SECONDS, false) };
    }
}

/// Follows the keys and buttons the user physically holds: the transitions of
/// events no process posted, on top of those down in the HID state when the
/// tap starts. Without a tap (no Input Monitoring) the helper cannot tell the
/// user's holds from the request's, so it exits and the request goes on
/// without it.
pub(crate) fn observe(observation: &Arc<Observation>, mut ready: UnixStream) {
    // The first query loads the HID state, which takes milliseconds; it runs
    // before the tap so the tap's events do not pile up meanwhile.
    // SAFETY: [FFI] read-only query of the HID system state.
    unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, 0) };
    let mask = TRANSITION_TYPES.iter().fold(0u64, |mask, &kind| mask | (1 << kind));
    let context = Box::into_raw(Box::new(Context { observation: Arc::clone(observation), port: ptr::null_mut() }));
    let mut tap = TAP.lock().unwrap_or_else(PoisonError::into_inner);
    if !matches!(*tap, TapState::Unstarted) {
        return;
    }
    // SAFETY: [FFI] a listen-only session tap whose context is leaked, so it
    // lives for the rest of the process.
    let port = unsafe { CGEventTapCreate(SESSION_EVENT_TAP, HEAD_INSERT, LISTEN_ONLY, mask, observed, context.cast()) };
    if port.is_null() {
        std::process::exit(0);
    }
    // SAFETY: [data race] `context` is live and only this thread writes it,
    // before the run loop that calls back on this thread runs.
    unsafe { (*context).port = port };
    *tap = TapState::Running(Port(port));
    drop(tap);
    // SAFETY: [FFI] `port` is live; the source and run loop stay alive while
    // the loop runs, which is until the process exits.
    unsafe {
        let source = CFMachPortCreateRunLoopSource(ptr::null(), port, 0);
        if source.is_null() {
            close();
            std::process::exit(0);
        }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
        CGEventTapEnable(port, true);
    }
    // Before READY no press of this request is on the HID route, so what is
    // down is the user's.
    observation.holds().hold_all(hid_state());
    observation.follow(&RunLoop, || {
        if ready.write_all(&[READY]).is_err() {
            close();
            std::process::exit(0);
        }
    });
}

/// The keys and buttons down in the HID system state: the user's and every
/// process's presses alike.
fn hid_state() -> UserHolds {
    let mut down = UserHolds::default();
    for code in 0..128u16 {
        // SAFETY: [FFI] read-only query of the HID system state.
        if unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, code) } {
            down.set(Input::Key(code), true);
        }
    }
    for button in 0..32u8 {
        // SAFETY: [FFI] read-only query of the HID system state.
        if unsafe { CGEventSourceButtonState(HID_SYSTEM_STATE, u32::from(button)) } {
            down.set(Input::Button(button), true);
        }
    }
    down
}

extern "C" fn observed(_proxy: CgEventTapProxy, kind: u32, event: CgEventRef, user_info: *mut c_void) -> CgEventRef {
    // SAFETY: [use-after-free] `user_info` is the leaked `Context` this tap
    // was created with.
    let context = unsafe { &*user_info.cast::<Context>() };
    if TAP_DISABLED.contains(&kind) {
        // SAFETY: [FFI] the port outlives its callback.
        unsafe { CGEventTapEnable(context.port, true) };
        // The transitions of the disabled stretch are lost; the HID state says
        // where they left the user's holds.
        context.observation.holds().resync(hid_state());
        return event;
    }
    if event.is_null() {
        return event;
    }
    // SAFETY: [FFI] documented read-only fields of the live event handed to
    // this callback.
    let (pid, code, flags, button) = unsafe {
        (
            CGEventGetIntegerValueField(event, SOURCE_UNIX_PID_FIELD),
            CGEventGetIntegerValueField(event, KEYCODE_FIELD),
            CGEventGetFlags(event),
            CGEventGetIntegerValueField(event, BUTTON_NUMBER_FIELD),
        )
    };
    let mut holds = context.observation.holds();
    let code = u16::try_from(code).unwrap_or(u16::MAX);
    let seen = transition(kind, code, flags, button, |input| holds.has(input));
    match (seen, pid) {
        // A process posted it: it tells only whose a read-back hold was.
        (Some(Transition::Release(input)), pid) if pid != 0 => holds.posted_release(input),
        (_, pid) if pid != 0 => {}
        (Some(Transition::Press(input)), _) => holds.set(input, true),
        (Some(Transition::Release(input)), _) => holds.set(input, false),
        (Some(Transition::Move(_)) | None, _) => {}
    }
    event
}
