//! Member-exit wakes for RUNNING and LINGERING (design v4.2 section 7.2): each F member's process handle gets a
//! one-shot wait whose callback posts a packet to H's port, so the loop re-reads F's count when a member's process
//! object signals. A member's `EXIT_PROCESS` message arrives before F's count drops, and its handle can signal just
//! before the drop too; nothing is posted after it (kernel exit ordering row).
use std::ffi::c_void;
use std::ptr::null;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    OpenProcess, RegisterWaitForSingleObject, UnregisterWaitEx, WaitForSingleObject, INFINITE,
    PROCESS_SYNCHRONIZE, WT_EXECUTEONLYONCE,
};
use windows_sys::Win32::System::IO::PostQueuedCompletionStatus;

use crate::job::JoinedJob;
use crate::win::Owned;

/// Distinct from run.rs's job (1) and pipe (2) keys.
pub const MEMBER_KEY: usize = 3;
/// How long a member-exit wake re-reads F's count when every watched member has exited but the count has not dropped
/// yet. The drop follows within microseconds (kernel exit ordering row) and posts nothing; past this bound the loop
/// falls back to `RECHECK_MS`.
const SETTLE: Duration = Duration::from_millis(20);

struct Watch {
    wait: HANDLE,
    process: Owned,
}

/// The registered waits; dropping it unregisters each one and waits for a running callback, so no callback can post
/// to a closed port.
pub struct MemberWaits {
    port: HANDLE,
    watches: Vec<Watch>,
}

unsafe extern "system" fn member_signaled(port: *mut c_void, _timed_out: bool) {
    // SAFETY: `port` is H's completion port, which outlives every registered wait (`MemberWaits` drops first).
    unsafe { PostQueuedCompletionStatus(port, 0, MEMBER_KEY, null()) };
}

impl MemberWaits {
    pub const fn new(port: HANDLE) -> Self {
        Self {
            port,
            watches: Vec::new(),
        }
    }

    /// Watches the process `pid` names now. A pid that no longer opens has already exited, which the caller's count
    /// read after this event sees; a reused pid only adds one spurious wake.
    pub fn watch(&mut self, pid: u32) {
        // SAFETY: plain open by pid; the result is checked by `Owned::new`.
        let Some(process) = Owned::new(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) }) else {
            return;
        };
        let mut wait: HANDLE = std::ptr::null_mut();
        // SAFETY: `wait` is writable; the process handle and the port outlive the registration (dropped after it).
        let registered = unsafe {
            RegisterWaitForSingleObject(
                &mut wait,
                process.raw(),
                Some(member_signaled),
                self.port.cast_const(),
                INFINITE,
                WT_EXECUTEONLYONCE,
            )
        } != 0;
        if registered {
            self.watches.push(Watch { wait, process });
        }
    }

    /// After a member-exit wake that leaves no watched member alive, re-reads F's count until it reaches 1 or
    /// `SETTLE` passes. With a member still alive the count stays above 1 and nothing is re-read.
    pub fn settle(&self, floor: &JoinedJob) {
        if !self.all_exited() {
            return;
        }
        let deadline = Instant::now() + SETTLE;
        while floor.active() != Ok(1) && Instant::now() < deadline {
            std::thread::yield_now();
        }
    }

    fn all_exited(&self) -> bool {
        self.watches.iter().all(|watch| {
            // SAFETY: a zero-timeout wait on a live process handle.
            unsafe { WaitForSingleObject(watch.process.raw(), 0) == WAIT_OBJECT_0 }
        })
    }
}

impl Drop for MemberWaits {
    fn drop(&mut self) {
        for watch in &self.watches {
            // SAFETY: a live registration; INVALID_HANDLE_VALUE waits for a callback already running to return.
            unsafe { UnregisterWaitEx(watch.wait, INVALID_HANDLE_VALUE) };
        }
    }
}
