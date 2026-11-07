//! Test-only token plumbing (design section 14): the restricted Medium-integrity launcher token and the token
//! facts every receipt records. Integrity is the reliable fact; `TokenElevation` on a restricted token may still
//! read elevated (round-3 note 8).
#![allow(
    dead_code,
    reason = "the launcher image and the test binaries use different subsets"
)]

use std::ffi::c_void;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{GetLastError, HANDLE};
use windows_sys::Win32::Security::{
    CreateRestrictedToken, CreateWellKnownSid, GetLengthSid, GetSidSubAuthority,
    GetSidSubAuthorityCount, GetTokenInformation, SetTokenInformation, TokenElevation,
    TokenIntegrityLevel, WinBuiltinAdministratorsSid, WinMediumLabelSid, DISABLE_MAX_PRIVILEGE,
    SECURITY_MAX_SID_SIZE, SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DUPLICATE, TOKEN_ELEVATION, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::SystemServices::SE_GROUP_INTEGRITY;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcess, OpenProcessToken,
    WaitForSingleObject, INFINITE, PROCESS_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOW,
};

use super::win::{command_line, wide, Owned};

pub struct Facts {
    pub elevated: bool,
    pub integrity: u32,
}

fn error() -> u32 {
    // SAFETY: reads the calling thread's last-error value.
    unsafe { GetLastError() }
}

fn well_known(kind: i32) -> Result<Vec<u8>, u32> {
    let mut sid = vec![0u8; usize::try_from(SECURITY_MAX_SID_SIZE).unwrap_or(68)];
    let mut size = SECURITY_MAX_SID_SIZE;
    // SAFETY: `sid` is writable for `size` bytes; no domain SID is needed for these builtin types.
    let ok = unsafe { CreateWellKnownSid(kind, null_mut(), sid.as_mut_ptr().cast(), &mut size) };
    if ok == 0 {
        Err(error())
    } else {
        Ok(sid)
    }
}

pub fn restricted_medium_token() -> Result<Owned, String> {
    let mut own = null_mut();
    let access = TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT;
    // SAFETY: the pseudo-handle names this process; `own` receives a new token handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut own) } == 0 {
        return Err(format!("open {}", error()));
    }
    let own = Owned(own);
    let mut admins =
        well_known(WinBuiltinAdministratorsSid).map_err(|code| format!("admins-sid {code}"))?;
    let deny_only = SID_AND_ATTRIBUTES {
        Sid: admins.as_mut_ptr().cast(),
        Attributes: 0,
    };
    let mut restricted = null_mut();
    // SAFETY: one SID_AND_ATTRIBUTES entry backed by `admins`, which outlives the call; no privilege or restricting list.
    let ok = unsafe {
        CreateRestrictedToken(
            own.raw(),
            DISABLE_MAX_PRIVILEGE,
            1,
            &deny_only,
            0,
            null(),
            0,
            null(),
            &mut restricted,
        )
    };
    if ok == 0 {
        return Err(format!("restrict {}", error()));
    }
    let restricted = Owned(restricted);
    let mut medium = well_known(WinMediumLabelSid).map_err(|code| format!("medium-sid {code}"))?;
    let label = TOKEN_MANDATORY_LABEL {
        Label: SID_AND_ATTRIBUTES {
            Sid: medium.as_mut_ptr().cast(),
            Attributes: SE_GROUP_INTEGRITY.unsigned_abs(),
        },
    };
    // SAFETY: `medium` is a valid SID produced above.
    let sid_length = unsafe { GetLengthSid(medium.as_mut_ptr().cast()) };
    let length =
        u32::try_from(std::mem::size_of::<TOKEN_MANDATORY_LABEL>()).unwrap_or(0) + sid_length;
    let label_ptr: *const c_void = std::ptr::from_ref(&label).cast();
    // SAFETY: `label` points at `medium`, which outlives the call; lowering a token's integrity needs no privilege.
    if unsafe { SetTokenInformation(restricted.raw(), TokenIntegrityLevel, label_ptr, length) } == 0
    {
        return Err(format!("integrity {}", error()));
    }
    Ok(restricted)
}

pub fn facts(token: HANDLE) -> Facts {
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned = 0u32;
    let size = u32::try_from(std::mem::size_of::<TOKEN_ELEVATION>()).unwrap_or(0);
    // SAFETY: `elevation` is writable for `size` bytes.
    unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            std::ptr::from_mut(&mut elevation).cast(),
            size,
            &mut returned,
        )
    };
    let mut buffer = [0u64; 16];
    let mut integrity = 0u32;
    // SAFETY: `buffer` is 128 aligned bytes, enough for a TOKEN_MANDATORY_LABEL and its SID.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            buffer.as_mut_ptr().cast(),
            128,
            &mut returned,
        )
    };
    if ok != 0 {
        // SAFETY: on success the buffer starts with a TOKEN_MANDATORY_LABEL whose SID lives inside the same buffer.
        unsafe {
            let label = &*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
            let count = *GetSidSubAuthorityCount(label.Label.Sid);
            integrity = *GetSidSubAuthority(label.Label.Sid, u32::from(count.saturating_sub(1)));
        }
    }
    Facts {
        elevated: elevation.TokenIsElevated != 0,
        integrity,
    }
}

pub fn process_facts(pid: u32) -> Option<Facts> {
    // SAFETY: plain open by pid; the result is checked before use.
    let process = Owned::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) })?;
    let mut token = null_mut();
    // SAFETY: `process` is a live handle; `token` receives a new handle.
    if unsafe { OpenProcessToken(process.raw(), TOKEN_QUERY, &mut token) } == 0 {
        return None;
    }
    let token = Owned(token);
    Some(facts(token.raw()))
}

pub fn run_as(token: &Owned, exe: &Path, args: &[&str]) -> Result<u32, u32> {
    let exe_text = exe.to_string_lossy();
    let mut line_args = vec![exe_text.as_ref()];
    line_args.extend_from_slice(args);
    let application = wide(&exe_text);
    let mut line = wide(&command_line(&line_args));
    // SAFETY: plain C structs for which all-zero is valid.
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = u32::try_from(std::mem::size_of::<STARTUPINFOW>()).unwrap_or(u32::MAX);
    startup.dwFlags = STARTF_USESTDHANDLES;
    // SAFETY: reads this process's standard handles; they are inheritable as the caller's launcher passed them.
    unsafe {
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    }
    // SAFETY: as above.
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: both strings are NUL-terminated and outlive the call; a restricted copy of this process's own primary
    // token needs no SeAssignPrimaryTokenPrivilege.
    let ok = unsafe {
        CreateProcessAsUserW(
            token.raw(),
            application.as_ptr(),
            line.as_mut_ptr(),
            null(),
            null(),
            1,
            0,
            null(),
            null(),
            &startup,
            &mut info,
        )
    };
    if ok == 0 {
        return Err(error());
    }
    let process = Owned(info.hProcess);
    drop(Owned(info.hThread));
    let mut code = 0u32;
    // SAFETY: `process` is live; the wait is the launcher's whole job, so it is unbounded by design.
    unsafe {
        WaitForSingleObject(process.raw(), INFINITE);
        GetExitCodeProcess(process.raw(), &mut code);
    }
    Ok(code)
}
