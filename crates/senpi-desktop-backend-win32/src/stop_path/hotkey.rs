//! One registration lifetime of the kill switch, on the listener thread:
//! `RegisterHotKey` with a null window posts `WM_HOTKEY` to this thread's
//! queue, and a `MsgWaitForMultipleObjects` loop drains the queue and beats
//! every 500 ms while the registration holds.

use std::time::{Duration, Instant};

use senpi_desktop_safety::HEARTBEAT_INTERVAL_MS;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_HOTKEY_ALREADY_REGISTERED, WAIT_FAILED};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MsgWaitForMultipleObjects, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, PM_REMOVE, QS_ALLINPUT,
    WM_APP, WM_HOTKEY,
};

use super::chord::{Hotkey, MOD_NOREPEAT};
use super::listener::Shared;

/// `stopReason` when another registration (any process) holds the chord.
pub(crate) const CHORD_TAKEN: &str = "hotkey-chord-taken";
/// `stopReason` when `RegisterHotKey` refused for any other reason.
pub(crate) const REGISTRATION_FAILED: &str = "hotkey-registration-failed";

/// The registration id (applications use 0x0000..=0xBFFF).
const HOTKEY_ID: i32 = 0x5E01;
/// Posted by the owner to wake the loop for a restart or shutdown request.
const WM_WAKE: u32 = WM_APP + 0x5E;
const HEARTBEAT: Duration = Duration::from_millis(HEARTBEAT_INTERVAL_MS);

/// How one registration lifetime ended.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Run {
    /// `RegisterHotKey` refused the chord.
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

/// Registers `hotkey`, runs the wait loop while it holds, and unregisters.
/// The `Global` path is live exactly while registered.
pub(super) fn run(shared: &Shared, hotkey: Hotkey) -> Run {
    if let Some(exit) = pending(shared) {
        return exit;
    }
    // SAFETY: [FFI] a null window binds the hotkey to this thread's queue;
    // the rest are scalars.
    let registered = unsafe {
        RegisterHotKey(
            std::ptr::null_mut(),
            HOTKEY_ID,
            hotkey.modifiers | MOD_NOREPEAT,
            hotkey.vk,
        )
    };
    if registered == 0 {
        // SAFETY: [FFI] read immediately after the failed call.
        let error = unsafe { GetLastError() };
        let reason = if error == ERROR_HOTKEY_ALREADY_REGISTERED {
            CHORD_TAKEN
        } else {
            REGISTRATION_FAILED
        };
        shared.settled(Some(reason));
        return Run::Refused;
    }
    shared.settled(None);
    let exit = pump(shared);
    // SAFETY: [FFI] releases the registration this thread made above; a
    // failure leaves nothing to clean up (the thread's hotkeys die with it).
    unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
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

fn pump(shared: &Shared) -> Run {
    let mut next_beat = Instant::now() + HEARTBEAT;
    loop {
        if let Some(exit) = pending(shared) {
            return exit;
        }
        let now = Instant::now();
        if now >= next_beat {
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

/// Removes every queued message; a `WM_HOTKEY` for this registration
/// latches the supervisor.
fn drain(shared: &Shared) {
    let mut message = MSG::default();
    // SAFETY: [FFI] `message` is a valid out slot; a null window selects all
    // of this thread's messages.
    while unsafe { PeekMessageW(&raw mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
        if message.message == WM_HOTKEY && i32::try_from(message.wParam) == Ok(HOTKEY_ID) {
            shared.chord_pressed();
        }
    }
}
