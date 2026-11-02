//! The watch's log as the session's [`UserInputFeed`], with the process
//! start time that tells a watched app from a later process reusing its id
//! (ported from oh-my-pi `desktop/macos/process.rs` `started`, 0838d2ab44).

use std::mem;
use std::sync::Arc;

use senpi_desktop_core::user_input::{UserInputFeed, UserPresses};

use super::UserInputLog;

pub(super) struct Feed(pub(super) Arc<UserInputLog>);

impl UserInputFeed for Feed {
    fn take(&self) -> UserPresses {
        self.0.take()
    }

    fn process_started(&self, pid: u32) -> Option<u64> {
        process_started(pid)
    }
}

/// When `pid` started, in microseconds since the epoch.
pub(crate) fn process_started(pid: u32) -> Option<u64> {
    let pid = libc::pid_t::try_from(pid).ok()?;
    let size = libc::c_int::try_from(mem::size_of::<libc::proc_bsdinfo>()).ok()?;
    // SAFETY: An all-zero bit pattern is valid for this plain C struct.
    let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
    // SAFETY: The buffer is exactly the kernel structure's size and outlives
    // the synchronous call.
    let written = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
    (written == size).then(|| info.pbi_start_tvsec.saturating_mul(1_000_000).saturating_add(info.pbi_start_tvusec))
}
