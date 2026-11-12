//! Whether a window's process runs above the engine: its `TokenIntegrityLevel` RID is higher than
//! the engine's own, or it refuses `PROCESS_QUERY_LIMITED_INFORMATION` / its token with access
//! denied (d-windows.md:303). Row 60's integrity probe replaces this read when it lands.

use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

/// The integrity RID of `process`, or `None` when its token cannot be read.
fn rid(process: HANDLE) -> Option<u32> {
    let mut token = HANDLE::default();
    // SAFETY: out-parameter; the token handle is closed below.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
    let mut buffer = vec![0u8; 64];
    let mut needed = 0u32;
    // SAFETY: `buffer` is large enough for a TOKEN_MANDATORY_LABEL with one SID; `needed` is checked.
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr().cast()),
            u32::try_from(buffer.len()).ok()?,
            &mut needed,
        )
    };
    // SAFETY: `token` was opened above.
    let _ = unsafe { CloseHandle(token) };
    read.ok()?;
    // SAFETY: GetTokenInformation filled a TOKEN_MANDATORY_LABEL whose SID points into `buffer`.
    unsafe {
        let label = &*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
        let count = *GetSidSubAuthorityCount(label.Label.Sid);
        Some(*GetSidSubAuthority(
            label.Label.Sid,
            u32::from(count.checked_sub(1)?),
        ))
    }
}

/// `true` when the process owning `window` is above the engine's integrity level or will not be read.
pub(super) fn elevated(window: HWND) -> bool {
    let mut pid = 0u32;
    // SAFETY: plain out-parameter.
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    // SAFETY: a pseudo-handle for this process; no close needed.
    let own = rid(unsafe { GetCurrentProcess() });
    // SAFETY: a query-only open; closed below.
    let Ok(target) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return true;
    };
    let theirs = rid(target);
    // SAFETY: opened above.
    let _ = unsafe { CloseHandle(target) };
    match (own, theirs) {
        (Some(own), Some(theirs)) => theirs > own,
        _ => true,
    }
}
