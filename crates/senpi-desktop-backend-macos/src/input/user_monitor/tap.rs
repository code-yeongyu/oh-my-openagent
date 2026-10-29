//! The watch's listen-only `CGEventTap` on its own thread and `CFRunLoop`,
//! running between calls as well as during input until its owner drops it.

use std::cell::Cell;
use std::ffi::c_void;
use std::ptr;
use std::sync::mpsc::{self, SyncSender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use super::ffi::{
    kCFRunLoopDefaultMode, CFMachPortCreateRunLoopSource, CFMachPortInvalidate, CFRelease,
    CFRetain, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRemoveSource, CFRunLoopRun,
    CFRunLoopSourceCreate, CFRunLoopSourceSignal, CFRunLoopStop, CFRunLoopWakeUp,
    CGEventGetIntegerValueField, CGEventTapCreate, CGEventTapEnable, CfMachPortRef, CfRunLoopRef,
    CfRunLoopSourceRef, CgEventRef, CgEventTapProxy, RunLoopSourceContext,
    ANNOTATED_SESSION_EVENT_TAP, HEAD_INSERT, LISTEN_ONLY, SOURCE_UNIX_PID_FIELD,
    SOURCE_USER_DATA_FIELD, TAP_DISABLED_BY_TIMEOUT, TAP_DISABLED_BY_USER_INPUT,
    TARGET_UNIX_PID_FIELD,
};
use super::{Heard, UserInputLog, USER_INPUT_MASK};

const THREAD_NAME: &str = "senpi-desktop-user-input";

/// What the callback reaches through `user_info`.
struct TapContext {
    log: Arc<UserInputLog>,
    tap: Cell<CfMachPortRef>,
    own_pid: i64,
}

extern "C" fn observe(
    _proxy: CgEventTapProxy,
    kind: u32,
    event: CgEventRef,
    user_info: *mut c_void,
) -> CgEventRef {
    // SAFETY: [use-after-free] `user_info` is the `TapContext` of `run`,
    // declared before every guard there: the sources leave the run loop and
    // the port is invalidated before it drops, and the tap calls back only
    // from that thread's `CFRunLoopRun`.
    let context = unsafe { &*user_info.cast::<TapContext>() };
    if kind == TAP_DISABLED_BY_TIMEOUT || kind == TAP_DISABLED_BY_USER_INPUT {
        // SAFETY: [FFI] the port is live while its callback runs.
        unsafe { CGEventTapEnable(context.tap.get(), true) };
        return event;
    }
    if event.is_null() {
        return event;
    }
    // SAFETY: [FFI] `event` is the non-null event handed to this callback;
    // its documented integer fields are only read.
    let heard = unsafe {
        Heard {
            tag: CGEventGetIntegerValueField(event, SOURCE_USER_DATA_FIELD),
            source_pid: CGEventGetIntegerValueField(event, SOURCE_UNIX_PID_FIELD),
            target: CGEventGetIntegerValueField(event, TARGET_UNIX_PID_FIELD),
        }
    };
    // SAFETY: [FFI] the callback's non-null event remains live; field 9 is
    // kCGKeyboardEventKeycode. No event is modified or retained.
    let key = unsafe { CGEventGetIntegerValueField(event, 9) };
    context.log.observe_escape(kind, key, heard);
    context
        .log
        .observe(kind, heard, context.own_pid, crate::skylight::front_pid);
    // Listen-only: the event passes through untouched.
    event
}

extern "C" fn stop_loop(_info: *mut c_void) {
    // SAFETY: [FFI] `perform` runs on the monitor thread's own run loop.
    unsafe { CFRunLoopStop(CFRunLoopGetCurrent()) };
}

/// A CF object created on the tap thread and released there once.
struct CfOwned(*mut c_void);

impl CfOwned {
    /// `None` for a failed (null) `Create`, which has nothing to release.
    fn created(object: *mut c_void) -> Option<Self> {
        if object.is_null() {
            None
        } else {
            Some(Self(object))
        }
    }
}

impl Drop for CfOwned {
    fn drop(&mut self) {
        // SAFETY: [double free] the pointer came from a CF `Create` call and
        // this guard is its only release.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

/// The tap's port: invalidated, so no callback can follow, then released.
struct Port(CfMachPortRef);

impl Drop for Port {
    fn drop(&mut self) {
        // SAFETY: [FFI] the port came from `CGEventTapCreate`; invalidating
        // is idempotent and this guard is its only release.
        unsafe {
            CFMachPortInvalidate(self.0);
            CFRelease(self.0.cast_const());
        }
    }
}

/// Both sources on the tap thread's run loop, removed on drop.
struct Registered {
    run_loop: CfRunLoopRef,
    sources: [CfRunLoopSourceRef; 2],
}

impl Drop for Registered {
    fn drop(&mut self) {
        for source in self.sources {
            // SAFETY: [FFI] each source was added to this run loop in this mode.
            unsafe { CFRunLoopRemoveSource(self.run_loop, source, kCFRunLoopDefaultMode) };
        }
    }
}

/// A retain the owner holds so it can stop the loop from another thread.
struct Retained(*mut c_void);

// SAFETY: [data race] the owner only signals, wakes and releases these CF
// objects, which CoreFoundation documents as safe from any thread.
unsafe impl Send for Retained {}

impl Drop for Retained {
    fn drop(&mut self) {
        // SAFETY: [double free] one `CFRetain` taken for this owner.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

/// The running tap thread; dropping it stops the loop and joins the thread.
pub(super) struct Monitor {
    thread: Option<JoinHandle<()>>,
    run_loop: Retained,
    stop_source: Retained,
}

impl Monitor {
    /// `None` when macOS refused the tap or its thread could not start.
    pub(super) fn start(log: Arc<UserInputLog>) -> Option<Self> {
        let (ready, started) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name(THREAD_NAME.into())
            .spawn(move || run(log, &ready))
            .ok()?;
        match started.recv() {
            Ok(Some((run_loop, stop_source))) => Some(Self {
                thread: Some(thread),
                run_loop,
                stop_source,
            }),
            Ok(None) | Err(_) => {
                // The thread already returned; a panic there was reported by
                // the panic hook.
                thread.join().unwrap_or(());
                None
            }
        }
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        // SAFETY: [FFI] both objects stay retained by `self`; a signaled
        // source stays pending even if the loop has not started running.
        unsafe {
            CFRunLoopSourceSignal(self.stop_source.0);
            CFRunLoopWakeUp(self.run_loop.0);
        }
        if let Some(thread) = self.thread.take() {
            // A panic on the tap thread was reported by the panic hook.
            thread.join().unwrap_or(());
        }
    }
}

/// One tap lifetime on this thread: create, register, report ready, run
/// until stopped, tear down.
fn run(log: Arc<UserInputLog>, ready: &SyncSender<Option<(Retained, Retained)>>) {
    let context = TapContext {
        log,
        tap: Cell::new(ptr::null_mut()),
        own_pid: i64::from(std::process::id()),
    };
    let user_info = ptr::from_ref(&context).cast_mut().cast::<c_void>();
    // SAFETY: [FFI] a listen-only annotated-session tap; `user_info` points at
    // `context`, declared before every guard below and so dropped after them.
    let tap = unsafe {
        CGEventTapCreate(
            ANNOTATED_SESSION_EVENT_TAP,
            HEAD_INSERT,
            LISTEN_ONLY,
            USER_INPUT_MASK,
            observe,
            user_info,
        )
    };
    if tap.is_null() {
        ready.send(None).unwrap_or(());
        return;
    }
    let _port = Port(tap);
    context.tap.set(tap);
    let mut stop_context = RunLoopSourceContext {
        version: 0,
        info: ptr::null_mut(),
        retain: None,
        release: None,
        copy_description: None,
        equal: None,
        hash: None,
        schedule: None,
        cancel: None,
        perform: Some(stop_loop),
    };
    // SAFETY: [FFI] `tap` is the live port; the version-0 context is copied
    // when the source is created.
    let (source, stop_source) = unsafe {
        (
            CFMachPortCreateRunLoopSource(ptr::null(), tap, 0),
            CFRunLoopSourceCreate(ptr::null(), -1, &mut stop_context),
        )
    };
    let (Some(_source), Some(_stop_source)) =
        (CfOwned::created(source), CfOwned::created(stop_source))
    else {
        ready.send(None).unwrap_or(());
        return;
    };
    // SAFETY: [FFI] returns this thread's run loop; no arguments.
    let run_loop = unsafe { CFRunLoopGetCurrent() };
    // SAFETY: [FFI] live run loop, live sources, CF-provided mode constant.
    unsafe {
        CFRunLoopAddSource(run_loop, source, kCFRunLoopDefaultMode);
        CFRunLoopAddSource(run_loop, stop_source, kCFRunLoopDefaultMode);
    }
    let _registered = Registered {
        run_loop,
        sources: [source, stop_source],
    };
    // SAFETY: [FFI] `tap` is live.
    unsafe { CGEventTapEnable(tap, true) };
    // SAFETY: [FFI] the run loop and the stop source are live CF objects;
    // each retain is released by its `Retained`.
    let handles = unsafe {
        (
            Retained(CFRetain(run_loop.cast_const()).cast_mut()),
            Retained(CFRetain(stop_source.cast_const()).cast_mut()),
        )
    };
    if ready.send(Some(handles)).is_err() {
        return;
    }
    // SAFETY: [FFI] runs this thread's loop until `stop_loop` stops it.
    unsafe { CFRunLoopRun() };
}
