//! Mandatory integrity labels: the engine's own level (`integrityLevel` in the
//! capabilities) and whether a window's process runs above it, which UIPI
//! turns into silently dropped input.

use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

use windows_sys::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Lowest RID of each band (`SECURITY_MANDATORY_*_RID`, winnt.h).
const MEDIUM_RID: u32 = 0x2000;
const HIGH_RID: u32 = 0x3000;
const SYSTEM_RID: u32 = 0x4000;

/// The last sub-authority of a token's mandatory label SID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct IntegrityRid(pub(crate) u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IntegrityLevel {
    Low,
    Medium,
    High,
    System,
}

impl IntegrityRid {
    /// Untrusted folds into `low` and protected-process into `system`.
    pub(crate) const fn level(self) -> IntegrityLevel {
        match self.0 {
            rid if rid >= SYSTEM_RID => IntegrityLevel::System,
            rid if rid >= HIGH_RID => IntegrityLevel::High,
            rid if rid >= MEDIUM_RID => IntegrityLevel::Medium,
            _ => IntegrityLevel::Low,
        }
    }
}

impl IntegrityLevel {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::System => "system",
        }
    }
}

/// The engine process's integrity RID.
///
/// # Errors
/// The OS error of opening or reading the process token.
pub(crate) fn current_process() -> io::Result<IntegrityRid> {
    // SAFETY: [FFI] `GetCurrentProcess` takes no arguments and returns a
    // pseudo-handle that needs no close.
    let process = unsafe { GetCurrentProcess() };
    token_rid(process)
}

/// `Some(true)` when process `pid` runs above `own` or refuses the limited
/// query with access denied (protected and elevated processes do), `Some(false)`
/// at or below `own`, `None` when the process could not be examined (exited).
pub(crate) fn process_elevated(pid: u32, own: IntegrityRid) -> Option<bool> {
    // SAFETY: [FFI] plain value arguments; the returned handle is checked for
    // null before use.
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if raw.is_null() {
        return denied(&io::Error::last_os_error());
    }
    // SAFETY: [Double free] `raw` is a non-null handle `OpenProcess` just
    // returned; nothing else owns it, so `OwnedHandle` closes it exactly once.
    let process = unsafe { OwnedHandle::from_raw_handle(raw) };
    match token_rid(process.as_raw_handle()) {
        Ok(rid) => Some(rid > own),
        Err(error) => denied(&error),
    }
}

fn denied(error: &io::Error) -> Option<bool> {
    (error.kind() == io::ErrorKind::PermissionDenied).then_some(true)
}

fn token_rid(process: *mut c_void) -> io::Result<IntegrityRid> {
    let mut raw_token = std::ptr::null_mut();
    // SAFETY: [FFI] `process` is a live process handle (the current-process
    // pseudo-handle or one the caller owns) and `raw_token` is a valid out slot.
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &raw mut raw_token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: [Double free] `OpenProcessToken` succeeded, so `raw_token` is a
    // fresh handle owned only here and closed once by `OwnedHandle`.
    let token = unsafe { OwnedHandle::from_raw_handle(raw_token) };
    let mut needed = 0u32;
    // SAFETY: [FFI] size query: a null buffer with length 0 is the documented
    // form; `needed` is a valid out slot. The expected failure is
    // ERROR_INSUFFICIENT_BUFFER, so only `needed` is read.
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIntegrityLevel,
            std::ptr::null_mut(),
            0,
            &raw mut needed,
        )
    };
    let bytes = usize::try_from(needed).map_err(io::Error::other)?;
    if bytes < size_of::<TOKEN_MANDATORY_LABEL>() {
        return Err(io::Error::last_os_error());
    }
    // `u64` words keep the buffer aligned for the pointer-bearing label.
    let mut buffer = vec![0u64; bytes.div_ceil(size_of::<u64>())];
    // SAFETY: [Out-of-bounds] `buffer` spans at least `needed` bytes and is
    // 8-byte aligned, which covers `TOKEN_MANDATORY_LABEL`'s alignment.
    let filled = unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIntegrityLevel,
            buffer.as_mut_ptr().cast(),
            needed,
            &raw mut needed,
        )
    };
    if filled == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: [Uninitialized memory] the call succeeded, so the buffer starts
    // with an initialized, aligned label whose SID points inside `buffer`.
    let label = unsafe { buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>().read() };
    // SAFETY: [Use-after-free] the SID lives in `buffer`, alive for this scope;
    // the returned pointer addresses its sub-authority count byte.
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    let last = count
        .checked_sub(1)
        .ok_or_else(|| io::Error::other("integrity label SID has no sub-authority"))?;
    // SAFETY: [Out-of-bounds] `last < count`, so the pointer addresses the
    // final sub-authority inside the SID in `buffer`.
    let rid = unsafe { *GetSidSubAuthority(label.Label.Sid, u32::from(last)) };
    Ok(IntegrityRid(rid))
}

#[cfg(test)]
mod tests {
    use super::{IntegrityLevel, IntegrityRid};

    #[test]
    fn rid_bands_map_to_the_four_labels() {
        let cases = [
            (0x0000, IntegrityLevel::Low),
            (0x1000, IntegrityLevel::Low),
            (0x2000, IntegrityLevel::Medium),
            (0x2100, IntegrityLevel::Medium),
            (0x3000, IntegrityLevel::High),
            (0x4000, IntegrityLevel::System),
            (0x5000, IntegrityLevel::System),
        ];
        for (rid, level) in cases {
            assert_eq!(IntegrityRid(rid).level(), level, "rid {rid:#x}");
        }
    }
}
