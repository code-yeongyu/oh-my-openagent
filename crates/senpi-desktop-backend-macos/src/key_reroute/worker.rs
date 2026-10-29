use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc::SyncSender, Arc};
use std::time::Instant;

use senpi_desktop_core::key_reroute::audit::{AuditLease, AuditSink, DisarmReason};
use senpi_desktop_core::key_reroute::{Chord, Holder, Theft, LINGER_MAX};

use super::ffi::*;
use super::tap::{key_down, modifier_flags, mouse_buttons, observe_focus, route_key, TapContext};
use super::{keyboard_holders, REGISTRY};

pub(super) struct Tap(pub(super) Ref);

impl Drop for Tap {
    fn drop(&mut self) {
        // SAFETY: Each port is created on this thread and invalidated before
        // its callback context is dropped.
        unsafe {
            CFMachPortInvalidate(self.0);
            CFRelease(self.0.cast_const());
        }
    }
}

struct Source(Ref);

struct ContextOwner(*mut TapContext);

impl ContextOwner {
    fn new(context: TapContext) -> Self {
        Self(Box::into_raw(Box::new(context)))
    }

    fn get_mut(&mut self) -> &mut TapContext {
        // SAFETY: This is the sole owner. Worker borrows end before driving
        // the run loop, where callbacks borrow through the same raw pointer.
        unsafe { &mut *self.0 }
    }
}

impl Drop for ContextOwner {
    fn drop(&mut self) {
        // SAFETY: The owning pointer came from Box::into_raw. This owner is
        // declared before the ports, so their invalidation precedes this free.
        unsafe { drop(Box::from_raw(self.0)) };
    }
}

// An independent retain for an exit hook; invalidation is thread-safe and
// never frees the worker's callback context.
pub(super) struct ExitPort(Ref);

// SAFETY: CF ports are retained while shared; the only cross-thread operation
// is the idempotent CFMachPortInvalidate, documented as thread-safe.
unsafe impl Send for ExitPort {}
// SAFETY: As above; no Rust data behind the pointer is accessed.
unsafe impl Sync for ExitPort {}

impl ExitPort {
    pub(super) fn retain(port: &Tap) -> Self {
        // SAFETY: This takes a separate retain on a live create-rule CF port.
        Self(unsafe { CFRetain(port.0.cast_const()).cast_mut() })
    }

    pub(super) fn invalidate(&self) {
        // SAFETY: The exit registration owns this retain; invalidation is
        // idempotent and safe during a callback on another thread.
        unsafe { CFMachPortInvalidate(self.0) };
    }
}

impl Drop for ExitPort {
    fn drop(&mut self) {
        // SAFETY: Releases exactly this registration's retain.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

impl Drop for Source {
    fn drop(&mut self) {
        // SAFETY: This owns the create-rule reference.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

pub(super) fn run(
    user: i32,
    target: i32,
    generation: u64,
    ended: Arc<AtomicBool>,
    halt: Arc<AtomicBool>,
    ready: SyncSender<bool>,
    audit: AuditSink,
) {
    if super::tap::secure_entry() {
        let _ = ready.send(false);
        return;
    }
    let mut context = ContextOwner::new(TapContext {
        theft: Theft::new(user, target, mouse_buttons(), generation),
        chord: Chord::new(modifier_flags(), Instant::now()),
        focus_tap: ptr::null_mut(),
        key_tap: ptr::null_mut(),
        moved_events: 0,
        audit: None,
    });
    let context_ptr = context.0.cast();
    let focus_mask = (1 << PROCESS_NOTIFICATION) | (1 << FLAGS_CHANGED);
    // SAFETY: The heap context stays alive through both port lifetimes;
    // callbacks run only while this thread drives the run loop.
    let focus = unsafe {
        CGEventTapCreate(
            ANNOTATED_SESSION,
            TAIL_APPEND,
            LISTEN_ONLY,
            focus_mask,
            observe_focus,
            context_ptr,
        )
    };
    if focus.is_null() {
        eprintln!("computer use keyboard reroute unavailable: focus tap");
        let _ = ready.send(false);
        return;
    }
    let focus = Tap(focus);
    let key_mask = (1 << KEY_DOWN) | (1 << KEY_UP) | (1 << FLAGS_CHANGED);
    // SAFETY: Same context lifetime; filtering applies only to target's keys.
    let key = unsafe {
        CGEventTapCreateForPid(
            target,
            HEAD_INSERT,
            ACTIVE_FILTER,
            key_mask,
            route_key,
            context_ptr,
        )
    };
    if key.is_null() {
        eprintln!("computer use keyboard reroute unavailable: target key tap");
        let _ = ready.send(false);
        return;
    }
    let key = Tap(key);
    let focus_exit = ExitPort::retain(&focus);
    let key_exit = ExitPort::retain(&key);
    let stop_on_exit = Arc::clone(&halt);
    let _exit = crate::exit_safety::register(move || {
        stop_on_exit.store(true, Ordering::Release);
        focus_exit.invalidate();
        key_exit.invalidate();
    });
    context.get_mut().focus_tap = focus.0;
    context.get_mut().key_tap = key.0;
    // SAFETY: Both ports are live. A null allocation must not be added to the loop.
    let focus_source = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), focus.0, 0) };
    if focus_source.is_null() {
        eprintln!("computer use keyboard reroute unavailable: focus run-loop source");
        let _ = ready.send(false);
        return;
    }
    let focus_source = Source(focus_source);
    // SAFETY: As above.
    let key_source = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), key.0, 0) };
    if key_source.is_null() {
        eprintln!("computer use keyboard reroute unavailable: key run-loop source");
        let _ = ready.send(false);
        return;
    }
    let key_source = Source(key_source);
    // SAFETY: The current thread owns this run loop and both sources.
    let run_loop = unsafe {
        let run_loop = CFRunLoopGetCurrent();
        CFRunLoopAddSource(run_loop, focus_source.0, kCFRunLoopDefaultMode);
        CFRunLoopAddSource(run_loop, key_source.0, kCFRunLoopDefaultMode);
        CGEventTapEnable(focus.0, true);
        CGEventTapEnable(key.0, true);
        run_loop
    };
    let now = Instant::now();
    {
        let context = context.get_mut();
        let signals = context.signals(now);
        context
            .theft
            .register(&mut REGISTRY.lock(), keyboard_holders(), signals, now);
        context.audit = Some(AuditLease::arm(generation, audit));
    }
    let started = ready.send(true).is_ok();
    let mut ended_at = None;
    let mut reason = "keyboard-returned";
    while started && !halt.load(Ordering::Acquire) {
        // SAFETY: Sources and context stay alive until removed below.
        unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false) };
        let context = context.get_mut();
        let now = Instant::now();
        if context.theft.holder == Holder::UserChose {
            reason = "user-choice";
        }
        if ended.load(Ordering::Acquire) {
            let since = *ended_at.get_or_insert(now);
            let front = keyboard_holders().map(|(front, _)| front);
            if front == Some(target) && reason == "keyboard-returned" {
                reason = "target-visible";
            } else if now.saturating_duration_since(since) >= LINGER_MAX
                && reason == "keyboard-returned"
            {
                reason = "linger-expired";
            }
            context
                .theft
                .linger(front, now.saturating_duration_since(since));
        }
        let mut registry = REGISTRY.lock();
        registry.prune_lifted(target, key_down, now);
        let (latest, latest_target) = registry.latest;
        if latest != generation {
            if reason == "keyboard-returned" {
                reason = "superseded";
            }
            if latest_target == target {
                break;
            }
            context.theft.end();
        }
        context.theft.publish(&mut registry);
        if ended_at.is_some() && context.theft.settled(&registry) {
            break;
        }
    }
    if halt.load(Ordering::Acquire) && reason == "keyboard-returned" {
        reason = "engine-exit";
    }
    context.get_mut().theft.end();
    context.get_mut().theft.publish(&mut REGISTRY.lock());
    // SAFETY: Remove sources before their references and callback context drop.
    unsafe {
        CFRunLoopRemoveSource(run_loop, focus_source.0, kCFRunLoopDefaultMode);
        CFRunLoopRemoveSource(run_loop, key_source.0, kCFRunLoopDefaultMode);
    }
    eprintln!(
        "computer use keyboard reroute finished: moved_events={} reason={reason}",
        context.get_mut().moved_events,
    );
    if let Some(audit) = &mut context.get_mut().audit {
        audit.disarm_reason(match reason {
            "user-choice" => DisarmReason::UserChoice,
            "target-visible" => DisarmReason::TargetVisible,
            "linger-expired" => DisarmReason::LingerExpired,
            "superseded" => DisarmReason::Superseded,
            "engine-exit" => DisarmReason::EngineExit,
            _ => DisarmReason::KeyboardReturned,
        });
    }
    // Ports cannot call the context after invalidation. Audit disarm is last,
    // after both taps and run-loop sources are gone.
    drop(key);
    drop(focus);
    drop(key_source);
    drop(focus_source);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_and_worker_borrows_share_the_owned_heap_context() {
        let mut owner = ContextOwner::new(TapContext {
            theft: Theft::new(101, 202, [0; 6], 1),
            chord: Chord::new(0, Instant::now()),
            focus_tap: ptr::null_mut(),
            key_tap: ptr::null_mut(),
            moved_events: 0,
            audit: None,
        });
        let callback = owner.0;
        for expected in 1..=3 {
            owner.get_mut().moved_events = expected;
            // SAFETY: The worker borrow has ended, as it does before each
            // run-loop callback, and the owning allocation remains live.
            unsafe {
                let context = &mut *callback;
                assert_eq!(context.moved_events, expected);
                context.moved_events += 1;
            }
            assert_eq!(owner.get_mut().moved_events, expected + 1);
        }
    }
}
