//! Windows: the lock directory is created with the protected DACL of A-IS-65 L3 (owner +
//! SYSTEM, full control, protected) and its descriptor is read back and admitted (`dacl`).
//! A directory that already exists and is owned by this user gets that DACL applied and is
//! read back the same way; one owned by anyone else, a reparse point, or a DACL that cannot
//! be set or read back refuses (L2). Every handle and every buffer the calls return is freed.

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_ALREADY_EXISTS, HANDLE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW,
    SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetSecurityDescriptorDacl, GetTokenInformation, TokenOwner, TokenUser, ACL,
    DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_INFORMATION_CLASS, TOKEN_OWNER, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{CreateDirectoryW, FILE_ATTRIBUTE_REPARSE_POINT};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use super::dacl::{admit_dacl, owner};

/// A buffer the system allocated with `LocalAlloc`, freed once.
struct Local(*mut c_void);

impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the pointer came from a call that hands its buffer to the caller.
            unsafe { LocalFree(self.0) };
        }
    }
}

struct Token(HANDLE);

impl Drop for Token {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful OpenProcessToken and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

fn win32(code: u32) -> io::Result<()> {
    if code == 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(
            i32::try_from(code).unwrap_or(i32::MAX),
        ))
    }
}

/// A NUL-terminated wide string the system allocated, read and freed.
fn take_wide(text: *mut u16) -> String {
    let owned = Local(text.cast());
    let mut length = 0;
    // SAFETY: the system returned a NUL-terminated string; reading stops at its NUL.
    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: `length` units were just read as initialised.
    let units = unsafe { std::slice::from_raw_parts(text, length) };
    let read = String::from_utf16_lossy(units);
    drop(owned);
    read
}

/// The string SID of the token's user (`TokenUser`) or default owner (`TokenOwner`).
fn token_sid(class: TOKEN_INFORMATION_CLASS) -> io::Result<String> {
    let mut handle: HANDLE = std::ptr::null_mut();
    // SAFETY: the pseudo-handle of this process; the out-parameter is live and writable.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut handle) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = Token(handle);
    let mut needed = 0_u32;
    // SAFETY: a size query: no buffer, the needed length is written.
    unsafe { GetTokenInformation(token.0, class, std::ptr::null_mut(), 0, &raw mut needed) };
    let mut buffer = vec![0_u64; (needed as usize).div_ceil(8).max(1)];
    let size = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
    // SAFETY: the buffer is 8-byte aligned, writable and at least `needed` bytes long.
    let read = unsafe {
        GetTokenInformation(
            token.0,
            class,
            buffer.as_mut_ptr().cast(),
            size,
            &raw mut needed,
        )
    };
    if read == 0 {
        return Err(io::Error::last_os_error());
    }
    let sid = if class == TokenUser {
        // SAFETY: GetTokenInformation(TokenUser) filled the buffer with a TOKEN_USER.
        unsafe { (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid }
    } else {
        // SAFETY: GetTokenInformation(TokenOwner) filled the buffer with a TOKEN_OWNER.
        unsafe { (*buffer.as_ptr().cast::<TOKEN_OWNER>()).Owner }
    };
    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: the SID points into `buffer`, alive across the call; the out-parameter is live.
    if unsafe { ConvertSidToStringSidW(sid, &raw mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(take_wide(text))
}

/// The protected descriptor of L3 for `user`, built from its SDDL text.
fn descriptor(user: &str) -> io::Result<Local> {
    descriptor_text(&format!("O:{user}D:P(A;OICI;FA;;;{user})(A;OICI;FA;;;SY)"))
}

/// A descriptor built from SDDL `text`.
fn descriptor_text(text: &str) -> io::Result<Local> {
    let text = wide(std::ffi::OsStr::new(text));
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: a NUL-terminated wide string alive across the call; the out-parameter is live.
    let built = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text.as_ptr(),
            SDDL_REVISION_1,
            &raw mut sd,
            std::ptr::null_mut(),
        )
    };
    if built == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Local(sd))
}

/// `sid` as SDDL text writes it back (an alias such as `LA` for the local Administrator).
fn canonical(sid: &str) -> io::Result<String> {
    let sd = descriptor_text(&format!("O:{sid}"))?;
    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: a live descriptor; the out-parameter is live and writable.
    let converted = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            sd.0,
            SDDL_REVISION_1,
            OWNER_SECURITY_INFORMATION,
            &raw mut text,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(io::Error::last_os_error());
    }
    let read = take_wide(text);
    owner(&read)
        .map(str::to_owned)
        .ok_or_else(|| io::Error::other(format!("no owner in {read:?}")))
}

/// Creates `dir` with the descriptor; `false` when it already existed.
fn create(dir: &[u16], sd: &Local) -> io::Result<bool> {
    let attributes = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0),
        lpSecurityDescriptor: sd.0,
        bInheritHandle: 0,
    };
    // SAFETY: a NUL-terminated wide path and a live descriptor, both alive across the call.
    if unsafe { CreateDirectoryW(dir.as_ptr(), &raw const attributes) } != 0 {
        return Ok(true);
    }
    // SAFETY: reads this thread's last error, set by the failed call above.
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        return Ok(false);
    }
    Err(io::Error::last_os_error())
}

/// Applies the descriptor's protected DACL to the existing `dir`.
fn apply(dir: &[u16], sd: &Local) -> io::Result<()> {
    let mut present = 0;
    let mut defaulted = 0;
    let mut acl: *mut ACL = std::ptr::null_mut();
    // SAFETY: a live descriptor; every out-parameter is live and writable.
    if unsafe {
        GetSecurityDescriptorDacl(sd.0, &raw mut present, &raw mut acl, &raw mut defaulted)
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a NUL-terminated wide path; the ACL points into the live descriptor.
    win32(unsafe {
        SetNamedSecurityInfoW(
            dir.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            acl,
            std::ptr::null(),
        )
    })
}

/// The owner and DACL of `dir`, read back as SDDL text.
fn read_back(dir: &[u16]) -> io::Result<String> {
    let info = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: a NUL-terminated wide path; only the descriptor out-parameter is asked for.
    win32(unsafe {
        GetNamedSecurityInfoW(
            dir.as_ptr(),
            SE_FILE_OBJECT,
            info,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &raw mut sd,
        )
    })?;
    let sd = Local(sd);
    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: a live descriptor; the out-parameter is live and writable.
    let converted = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            sd.0,
            SDDL_REVISION_1,
            info,
            &raw mut text,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(take_wide(text))
}

/// Makes `dir` the protected lock directory of L3, or refuses (L2).
///
/// # Errors
/// The directory cannot be created, is a reparse point or not a directory, is owned by
/// another principal, or its DACL cannot be set or read back as L3's.
pub(crate) fn protected_dir(dir: &Path) -> io::Result<()> {
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // SDDL text names some SIDs by alias (LA, BA, SY): every SID is compared in the form the
    // read-back uses, its own descriptor's round trip.
    let user = canonical(&token_sid(TokenUser)?)?;
    let default_owner = canonical(&token_sid(TokenOwner)?)?;
    let owners = [user.as_str(), default_owner.as_str()];
    let path = wide(dir.as_os_str());
    let sd = descriptor(&user)?;
    let created = create(&path, &sd)?;
    let meta = std::fs::symlink_metadata(dir)?;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || !meta.is_dir() {
        return Err(io::Error::other(format!(
            "{} is a reparse point or not a directory",
            dir.display()
        )));
    }
    let first = read_back(&path)?;
    match admit_dacl(&first, &owners, &user) {
        Ok(()) => Ok(()),
        // A directory this call created, or one another principal owns, is never tightened.
        Err(error) if created || !owner(&first).is_some_and(|found| owners.contains(&found)) => {
            Err(error)
        }
        // An existing directory this user (or its default owner) owns gets L3's DACL applied.
        Err(_) => {
            apply(&path, &sd)?;
            admit_dacl(&read_back(&path)?, &owners, &user)
        }
    }
}
