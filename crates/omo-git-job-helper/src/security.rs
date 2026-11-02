//! The floor job's explicit DACL (design v4.2 section 14) and the token facts `selftest` reports.
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenElevation,
    TokenIntegrityLevel, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_ELEVATION,
    TOKEN_INFORMATION_CLASS, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::win::{last_error, wide, Owned};

/// JOB_OBJECT_QUERY | SYNCHRONIZE | READ_CONTROL for the creating user; SYSTEM gets full access. Nobody else can
/// assign, set limits or terminate (section 14).
const USER_JOB_RIGHTS: u32 = 0x0012_0004;

pub struct JobAttributes {
    pub attributes: SECURITY_ATTRIBUTES,
    descriptor: PSECURITY_DESCRIPTOR,
}

impl Drop for JobAttributes {
    fn drop(&mut self) {
        // SAFETY: the descriptor was LocalAlloc'd by ConvertStringSecurityDescriptorToSecurityDescriptorW.
        unsafe { LocalFree(self.descriptor) };
    }
}

fn own_token() -> Result<Owned, u32> {
    let mut token = null_mut();
    // SAFETY: the pseudo-handle names this process; `token` receives a new handle on success.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(last_error());
    }
    Owned::new(token).ok_or(0)
}

/// `GetTokenInformation` into an aligned 512-byte buffer, passing `length`: fixed-size classes such as
/// TokenElevation refuse any other length with ERROR_BAD_LENGTH.
fn token_info(
    token: &Owned,
    class: TOKEN_INFORMATION_CLASS,
    length: u32,
) -> Result<[u64; 64], u32> {
    let mut buffer = [0u64; 64];
    let mut returned = 0u32;
    // SAFETY: `buffer` is 512 aligned, writable bytes and the length passed never exceeds that.
    if unsafe {
        GetTokenInformation(
            token.raw(),
            class,
            buffer.as_mut_ptr().cast(),
            length.min(512),
            &mut returned,
        )
    } == 0
    {
        return Err(last_error());
    }
    Ok(buffer)
}

fn user_sid_text(token: &Owned) -> Result<String, u32> {
    let buffer = token_info(token, TokenUser, 512)?;
    let mut text = null_mut();
    // SAFETY: the buffer starts with a TOKEN_USER whose SID lives inside the same buffer.
    if unsafe {
        ConvertSidToStringSidW((*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid, &mut text)
    } == 0
    {
        return Err(last_error());
    }
    // SAFETY: `text` is a NUL-terminated, LocalAlloc'd wide string: read up to its NUL, then freed once.
    unsafe {
        let length = (0..).take_while(|&index| *text.add(index) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
        LocalFree(text.cast());
        Ok(sid)
    }
}

pub fn job_attributes() -> Result<JobAttributes, u32> {
    let token = own_token()?;
    let sddl = wide(&format!(
        "D:P(A;;GA;;;SY)(A;;{USER_JOB_RIGHTS:#x};;;{})",
        user_sid_text(&token)?
    ));
    let mut descriptor = null_mut();
    // SAFETY: `sddl` is NUL-terminated; the size out-parameter is optional.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    } == 0
    {
        return Err(last_error());
    }
    let length = u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0);
    Ok(JobAttributes {
        attributes: SECURITY_ATTRIBUTES {
            nLength: length,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        },
        descriptor,
    })
}

/// (TokenElevation, integrity RID). Integrity is the reliable fact for a restricted token (round-3 note 8).
pub fn token_facts() -> Result<(bool, u32), u32> {
    let token = own_token()?;
    let elevation_size = u32::try_from(std::mem::size_of::<TOKEN_ELEVATION>()).unwrap_or(4);
    let elevation = token_info(&token, TokenElevation, elevation_size)?;
    // SAFETY: the buffer starts with a TOKEN_ELEVATION.
    let elevated = unsafe { (*elevation.as_ptr().cast::<TOKEN_ELEVATION>()).TokenIsElevated != 0 };
    let label = token_info(&token, TokenIntegrityLevel, 512)?;
    // SAFETY: the buffer starts with a TOKEN_MANDATORY_LABEL whose SID lives inside the same buffer; the last
    // sub-authority of a mandatory-label SID is the integrity RID.
    let integrity = unsafe {
        let sid = (*label.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()).Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        *GetSidSubAuthority(sid, u32::from(count.saturating_sub(1)))
    };
    Ok((elevated, integrity))
}
