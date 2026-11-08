//! Resolve the OS account, never a caller-controlled HOME variable.
pub(super) fn uid() -> libc::uid_t {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}

#[cfg(not(test))]
pub(super) fn home() -> std::io::Result<std::path::PathBuf> {
    use std::{
        ffi::{CStr, OsStr},
        io,
        mem::MaybeUninit,
        os::unix::ffi::OsStrExt,
        path::PathBuf,
        ptr,
    };
    let mut record = MaybeUninit::<libc::passwd>::uninit();
    let mut storage = vec![0u8; 16 * 1024];
    let mut result = ptr::null_mut();
    // SAFETY: all outputs are writable; the buffer lives through record copying.
    let status = unsafe {
        libc::getpwuid_r(
            uid(),
            record.as_mut_ptr(),
            storage.as_mut_ptr().cast(),
            storage.len(),
            &mut result,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status));
    }
    if result.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "agent account is missing",
        ));
    }
    // SAFETY: successful getpwuid_r with non-null result initialized the record.
    let record = unsafe { record.assume_init() };
    if record.pw_dir.is_null() {
        return Err(io::Error::other("agent home is missing"));
    }
    // SAFETY: getpwuid_r returns a NUL-terminated pw_dir backed by live storage.
    let home = unsafe { CStr::from_ptr(record.pw_dir) };
    let path = PathBuf::from(OsStr::from_bytes(home.to_bytes()));
    if !path.is_absolute() {
        return Err(io::Error::other("agent home is not absolute"));
    }
    Ok(path)
}
