//! The release helper's state and what it admits (d-windows.md '## Input', RELEASE HELPER). After
//! spawning `omo-computer-engine --release-helper` with breakaway, the engine reads
//! `IsProcessInJob(helper, NULL)` back: TRUE is a measured failure - the helper would die with an
//! enclosing job before it releases anything - so every verb that holds a key or button is
//! refused; before the read-back only the explicit holds are refused.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::{ReleaseHelper, ReleaseHelperReason};
use omo_computer_core::error::{EngineCode, Reason};

/// What the helper read-back established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelperState {
    /// The read-back has not been taken yet.
    Unproven,
    /// The helper runs outside every job.
    Available,
    /// `IsProcessInJob(helper, NULL)` read TRUE.
    Unavailable,
}

/// How a verb uses input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbKind {
    /// `key.down` / `mouse.down`.
    Hold,
    /// `type`, `press`, `click`, `drag`, `scroll` on an input route: each holds a key or button
    /// for some interval.
    HoldingInput,
    /// UI Automation action verbs and clipboard paste: nothing is held.
    AxAction,
    Read,
}

/// The refusal of a verb that needs the release helper.
pub const RELEASE_HELPER_UNAVAILABLE: Refusal = Refusal::new(
    EngineCode::StopPathUnavailable,
    Reason::ReleaseHelperUnavailable.wire(),
);

impl HelperState {
    /// `None` before the read-back; `Some(in_job)` after it.
    #[must_use]
    pub const fn from_read_back(in_job: Option<bool>) -> Self {
        match in_job {
            None => Self::Unproven,
            Some(false) => Self::Available,
            Some(true) => Self::Unavailable,
        }
    }

    /// `capabilities().releaseHelper`.
    #[must_use]
    pub const fn capability(self) -> ReleaseHelper {
        match self {
            Self::Unavailable => ReleaseHelper {
                available: false,
                reason: Some(ReleaseHelperReason::EnclosingJobNoBreakaway),
            },
            Self::Unproven | Self::Available => ReleaseHelper {
                available: !matches!(self, Self::Unproven),
                reason: None,
            },
        }
    }

    /// `backgroundReach` reads `ax_only` when nothing can release a held input.
    #[must_use]
    pub const fn ax_only(self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

/// Admits `verb` under `state`, before any OS call.
///
/// # Errors
/// [`RELEASE_HELPER_UNAVAILABLE`] with nothing sent.
pub const fn admit(state: HelperState, verb: VerbKind) -> Result<(), Refusal> {
    match (state, verb) {
        (HelperState::Unavailable, VerbKind::Hold | VerbKind::HoldingInput)
        | (HelperState::Unproven, VerbKind::Hold) => Err(RELEASE_HELPER_UNAVAILABLE),
        _ => Ok(()),
    }
}

#[cfg(windows)]
pub use os::{spawn_outside_jobs, HelperProcess};

/// The Windows half the engine's `--release-helper` mode (row 28) calls: the spawn that leaves every
/// job and the read-back that decides [`HelperState`].
#[cfg(windows)]
mod os {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::BOOL;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::IsProcessInJob;
    use windows::Win32::System::Threading::{
        CreateProcessW, CREATE_BREAKAWAY_FROM_JOB, CREATE_NO_WINDOW, PROCESS_INFORMATION,
        STARTUPINFOW,
    };

    use super::HelperState;

    /// A started helper; its handle is closed on drop.
    pub struct HelperProcess {
        pub pid: u32,
        process: HANDLE,
    }

    impl HelperProcess {
        /// `IsProcessInJob(helper, NULL)`: the read-back that decides the state, whatever
        /// `CreateProcess` answered.
        #[must_use]
        pub fn state(&self) -> HelperState {
            let mut in_job = BOOL(0);
            // SAFETY: a live process handle and a plain out-parameter.
            let read = unsafe { IsProcessInJob(self.process, None, &mut in_job) };
            HelperState::from_read_back(read.ok().map(|()| in_job.as_bool()))
        }
    }

    impl Drop for HelperProcess {
        fn drop(&mut self) {
            // SAFETY: the handle CreateProcessW returned, closed once.
            let _ = unsafe { CloseHandle(self.process) };
        }
    }

    /// Starts `exe args` with `CREATE_BREAKAWAY_FROM_JOB`, inheriting no handle.
    ///
    /// # Errors
    /// The Win32 error of `CreateProcessW` (`ERROR_ACCESS_DENIED` when a job forbids breakaway).
    pub fn spawn_outside_jobs(exe: &Path, args: &str) -> windows::core::Result<HelperProcess> {
        let app: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut line: Vec<u16> = format!("\"{}\" {args}", exe.display())
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let startup = STARTUPINFOW {
            cb: u32::try_from(std::mem::size_of::<STARTUPINFOW>()).unwrap_or(0),
            ..Default::default()
        };
        let mut info = PROCESS_INFORMATION::default();
        // SAFETY: NUL-terminated buffers that outlive the call; no handle is inherited.
        unsafe {
            CreateProcessW(
                PCWSTR(app.as_ptr()),
                Some(PWSTR(line.as_mut_ptr())),
                None,
                None,
                false,
                CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW,
                None,
                PCWSTR::null(),
                &startup,
                &mut info,
            )?;
            let _ = CloseHandle(info.hThread);
        }
        Ok(HelperProcess {
            pid: info.dwProcessId,
            process: info.hProcess,
        })
    }
}
