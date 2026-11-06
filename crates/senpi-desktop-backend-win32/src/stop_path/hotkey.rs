//! One lifetime of the kill switch, on the listener thread: a
//! `WH_KEYBOARD_LL` hook ([`super::hook`]) decides physical chords, a
//! `RegisterHotKey` registration (when this process gets it) backs the hook
//! up while an elevated window blinds it, and a `MsgWaitForMultipleObjects`
//! loop services both and beats every 500 ms while the hook is installed.
//! The hook is re-installed on every beat (the new one before the old one is
//! removed), so a hook the system silently dropped is back within a beat.

use std::time::{Duration, Instant};

use senpi_desktop_safety::HEARTBEAT_INTERVAL_MS;
use std::sync::Arc;

use windows_sys::Win32::Foundation::WAIT_FAILED;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MsgWaitForMultipleObjects, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, PM_REMOVE, QS_ALLINPUT,
    WM_APP, WM_HOTKEY,
};

use super::chord::{Hotkey, MOD_NOREPEAT};
use super::hook::{self, Hook};
use super::listener::Shared;

/// `stopReason` when the system refused the keyboard hook.
pub(crate) const HOOK_FAILED: &str = "keyboard-hook-failed";
/// `stopReason` before any attempt settled.
pub(crate) const REGISTRATION_FAILED: &str = "hotkey-registration-failed";

/// The registration id (applications use 0x0000..=0xBFFF).
const HOTKEY_ID: i32 = 0x5E01;
/// Posted by the owner to wake the loop for a restart or shutdown request.
const WM_WAKE: u32 = WM_APP + 0x5E;
pub(super) const HEARTBEAT: Duration = Duration::from_millis(HEARTBEAT_INTERVAL_MS);

/// How one registration lifetime ended.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Run {
    /// The system refused the keyboard hook.
    Refused,
    /// The wait failed while registered.
    Died,
    /// The owner asked for a new registration (a new chord or a retry).
    Restart,
    /// The owner dropped the listener.
    Shutdown,
}

/// Forces this thread's message queue into existence (the first
/// `PeekMessageW` creates it) and publishes the thread id, so a wake the
/// owner posts afterwards always lands.
pub(super) fn create_queue(shared: &Shared) {
    let mut message = MSG::default();
    // SAFETY: [FFI] `message` is a valid out slot; a null window selects this
    // thread's messages, and PM_NOREMOVE leaves the queue untouched.
    unsafe { PeekMessageW(&raw mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };
    // SAFETY: [FFI] no arguments.
    let thread_id = unsafe { GetCurrentThreadId() };
    shared.update(|control| control.thread_id = Some(thread_id));
}

/// Wakes the listener thread's wait. A refused post means the thread has
/// already exited; the request itself travels in the shared control state.
pub(super) fn wake(thread_id: Option<u32>) {
    if let Some(thread_id) = thread_id {
        // SAFETY: [FFI] scalar arguments; Win32 validates the thread id.
        let _posted = unsafe { PostThreadMessageW(thread_id, WM_WAKE, 0, 0) };
    }
}

/// Installs the hook and, when available, the hotkey backstop, runs the wait
/// loop, and removes both. The `Global` path is live exactly while the hook
/// is installed; another process holding the hotkey only costs the backstop.
pub(super) fn run(shared: &Arc<Shared>, hotkey: Hotkey) -> Run {
    if let Some(exit) = pending(shared) {
        return exit;
    }
    hook::arm(shared, hotkey);
    let Some(installed) = Hook::install() else {
        hook::disarm();
        shared.settled(Some(HOOK_FAILED));
        return Run::Refused;
    };
    // SAFETY: [FFI] a null window binds the hotkey to this thread's queue;
    // the rest are scalars.
    let backstop = unsafe {
        RegisterHotKey(
            std::ptr::null_mut(),
            HOTKEY_ID,
            hotkey.modifiers | MOD_NOREPEAT,
            hotkey.vk,
        )
    } != 0;
    shared.settled(None);
    let exit = pump(shared, installed);
    if backstop {
        // SAFETY: [FFI] releases the registration this thread made above; a
        // failure leaves nothing to clean up (the thread's hotkeys die with it).
        unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
    }
    hook::disarm();
    shared.unregistered();
    exit
}

/// A restart or shutdown request, consuming the restart flag.
fn pending(shared: &Shared) -> Option<Run> {
    let mut control = shared.control.lock();
    if control.shutdown {
        return Some(Run::Shutdown);
    }
    std::mem::take(&mut control.restart).then_some(Run::Restart)
}

fn pump(shared: &Shared, mut installed: Hook) -> Run {
    let mut next_beat = Instant::now() + HEARTBEAT;
    loop {
        if let Some(exit) = pending(shared) {
            drop(installed);
            return exit;
        }
        let now = Instant::now();
        if now >= next_beat {
            // The new hook goes in before the old one comes out, so there is
            // no instant without one.
            let Some(fresh) = Hook::install() else {
                return Run::Died;
            };
            installed = fresh;
            shared.heartbeat();
            next_beat = now + HEARTBEAT;
        }
        let timeout = u32::try_from(next_beat.saturating_duration_since(now).as_millis()).unwrap_or(u32::MAX);
        // SAFETY: [FFI] no handles (count 0, null array); wakes on any new
        // message for this thread or after `timeout` ms.
        let woke = unsafe { MsgWaitForMultipleObjects(0, std::ptr::null(), 0, timeout, QS_ALLINPUT) };
        if woke == WAIT_FAILED {
            return Run::Died;
        }
        drain(shared);
    }
}

/// Removes every queued message (the hook runs inside these calls); a
/// `WM_HOTKEY` the hook did not already account for latches the supervisor.
fn drain(shared: &Shared) {
    let mut message = MSG::default();
    // SAFETY: [FFI] `message` is a valid out slot; a null window selects all
    // of this thread's messages.
    while unsafe { PeekMessageW(&raw mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
        if message.message == WM_HOTKEY && i32::try_from(message.wParam) == Ok(HOTKEY_ID) && hook::take_hotkey_decision() {
            shared.request_stop();
        }
    }
}
