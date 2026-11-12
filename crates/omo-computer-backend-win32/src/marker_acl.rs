//! The stop marker and resume token are owner-only (d-windows.md '## Identity and permissions',
//! Per-user resources; acceptance 29): a PROTECTED DACL (no inherited ACE) granting full access to
//! the user's SID and SYSTEM and nobody else, read back after every write. The daemon starts
//! STOPPED when the marker cannot be read back owner-only.

/// The SDDL of the owner-only DACL for `user_sid`.
#[must_use]
pub fn owner_only_sddl(user_sid: &str) -> String {
    format!("D:P(A;;FA;;;{user_sid})(A;;FA;;;SY)")
}

/// Whether `dacl_sddl` is protected and grants exactly the user and SYSTEM, both present.
#[must_use]
pub fn is_owner_only(dacl_sddl: &str, user_sid: &str) -> bool {
    let Some(rest) = dacl_sddl.strip_prefix("D:") else {
        return false;
    };
    let flags_end = rest.find('(').unwrap_or(rest.len());
    if !rest[..flags_end].contains('P') {
        return false;
    }
    let trustees: Vec<&str> = rest[flags_end..]
        .split(')')
        .filter(|ace| !ace.is_empty())
        .filter_map(|ace| ace.trim_start_matches('(').rsplit(';').next())
        .collect();
    let allowed = |sid: &&str| *sid == user_sid || *sid == "SY" || *sid == "S-1-5-18";
    trustees.iter().all(allowed)
        && trustees.contains(&user_sid)
        && trustees
            .iter()
            .any(|sid| *sid == "SY" || *sid == "S-1-5-18")
}

#[cfg(windows)]
pub use os::{apply_owner_only, read_back_owner_only};

#[cfg(windows)]
mod os {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{
        GetFileSecurityW, GetTokenInformation, SetFileSecurityW, TokenUser,
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    use super::{is_owner_only, owner_only_sddl};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn path_wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    /// The current user's SID as a string.
    fn user_sid() -> windows::core::Result<String> {
        let mut token = HANDLE::default();
        // SAFETY: a pseudo-handle and an out-parameter; closed below.
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)? };
        let mut buffer = vec![0u8; 256];
        let mut needed = 0u32;
        // SAFETY: `buffer` is large enough for a TOKEN_USER with one SID.
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                u32::try_from(buffer.len()).unwrap_or(0),
                &mut needed,
            )
        };
        // SAFETY: opened above.
        let _ = unsafe { CloseHandle(token) };
        read?;
        let mut text = PWSTR::null();
        // SAFETY: the SID points into `buffer`; `text` is freed with LocalFree.
        unsafe {
            let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
            ConvertSidToStringSidW(user.User.Sid, &mut text)?;
            let sid = text.to_string().unwrap_or_default();
            let _ = LocalFree(Some(HLOCAL(text.0.cast())));
            Ok(sid)
        }
    }

    /// Writes the owner-only protected DACL on `path`.
    ///
    /// # Errors
    /// The Win32 error of the conversion or the write.
    pub fn apply_owner_only(path: &Path) -> windows::core::Result<()> {
        let sddl = wide(&owner_only_sddl(&user_sid()?));
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        // SAFETY: a NUL-terminated SDDL; the descriptor is freed with LocalFree.
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut descriptor,
                None,
            )?;
            let written = SetFileSecurityW(
                PCWSTR(path_wide(path).as_ptr()),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor,
            );
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
            written.ok()
        }
    }

    /// Reads `path`'s DACL back and checks it is owner-only.
    ///
    /// # Errors
    /// The Win32 error of the read.
    pub fn read_back_owner_only(path: &Path) -> windows::core::Result<bool> {
        let file = path_wide(path);
        let mut needed = 0u32;
        // SAFETY: a size query; the buffer is sized from it below.
        let _ = unsafe {
            GetFileSecurityW(
                PCWSTR(file.as_ptr()),
                DACL_SECURITY_INFORMATION.0,
                None,
                0,
                &mut needed,
            )
        };
        let mut buffer = vec![0u8; usize::try_from(needed).unwrap_or(0)];
        let descriptor = PSECURITY_DESCRIPTOR(buffer.as_mut_ptr().cast());
        // SAFETY: `buffer` has the size the query returned.
        unsafe {
            GetFileSecurityW(
                PCWSTR(file.as_ptr()),
                DACL_SECURITY_INFORMATION.0,
                Some(descriptor),
                needed,
                &mut needed,
            )
        }
        .ok()?;
        let mut text = PWSTR::null();
        // SAFETY: a valid descriptor; `text` is freed with LocalFree.
        unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                None,
            )?;
            let sddl = text.to_string().unwrap_or_default();
            let _ = LocalFree(Some(HLOCAL(text.0.cast())));
            Ok(is_owner_only(&sddl, &user_sid()?))
        }
    }
}
