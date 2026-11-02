use std::ptr::null_mut;

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use super::win::{last_error, wide, Owned};

/// Owned SECURITY_ATTRIBUTES built from SDDL; the descriptor is freed on drop.
pub struct Attributes {
    pub attributes: SECURITY_ATTRIBUTES,
    descriptor: PSECURITY_DESCRIPTOR,
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: the descriptor came from ConvertStringSecurityDescriptorToSecurityDescriptorW, which LocalAllocs it.
        unsafe { LocalFree(self.descriptor) };
    }
}

pub fn from_sddl(text: &str) -> Result<Attributes, u32> {
    let text = wide(text);
    let mut descriptor = null_mut();
    // SAFETY: `text` is NUL-terminated; the size out-parameter is optional.
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(last_error());
    }
    let length = u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0);
    Ok(Attributes {
        attributes: SECURITY_ATTRIBUTES {
            nLength: length,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        },
        descriptor,
    })
}

pub fn current_user_sid() -> String {
    let mut token = null_mut();
    // SAFETY: the pseudo-handle names this process; `token` receives a new handle.
    assert!(
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } != 0,
        "OpenProcessToken {}",
        last_error()
    );
    let token = Owned(token);
    let mut buffer = [0u64; 64];
    let mut returned = 0u32;
    // SAFETY: `buffer` is 512 aligned bytes, enough for TOKEN_USER plus its SID.
    let ok = unsafe {
        GetTokenInformation(
            token.raw(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            512,
            &mut returned,
        )
    };
    assert!(ok != 0, "TokenUser {}", last_error());
    let mut text = null_mut();
    // SAFETY: on success the buffer starts with a TOKEN_USER whose SID lives in the same buffer.
    let ok = unsafe {
        ConvertSidToStringSidW((*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid, &mut text)
    };
    assert!(ok != 0, "ConvertSidToStringSidW {}", last_error());
    // SAFETY: `text` is a NUL-terminated LocalAlloc'd wide string; it is read up to its NUL, then freed once.
    unsafe {
        let length = (0..).take_while(|&index| *text.add(index) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
        LocalFree(text.cast());
        sid
    }
}

/// Lets a Medium-integrity participant of the same user open an object an elevated test created (N8, N9).
pub fn medium_user_sddl() -> String {
    format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{})S:(ML;;NW;;;ME)",
        current_user_sid()
    )
}
