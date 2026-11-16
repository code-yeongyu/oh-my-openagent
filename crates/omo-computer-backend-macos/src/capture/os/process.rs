//! Per-process reads: the start time from `proc_pidinfo` and the bundle id of the
//! application containing the executable.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use super::cf::{self, Owned};

/// The process start in microseconds since the epoch; `None` when the process is gone.
pub fn start(pid: u32) -> Option<u64> {
    let pid = i32::try_from(pid).ok()?;
    // SAFETY: proc_bsdinfo is plain integer and byte-array data; all-zero is a valid value.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = i32::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).ok()?;
    // SAFETY: `info` is a proc_bsdinfo of `size` bytes.
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&raw mut info).cast::<c_void>(),
            size,
        )
    };
    (read == size).then(|| info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec)
}

/// The executable path of `pid`.
pub fn path(pid: u32) -> Option<PathBuf> {
    let pid = i32::try_from(pid).ok()?;
    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let size = u32::try_from(buffer.len()).ok()?;
    // SAFETY: the buffer holds `size` bytes.
    let length = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), size) };
    let length = usize::try_from(length).ok().filter(|l| *l > 0)?;
    buffer.truncate(length);
    String::from_utf8(buffer).ok().map(PathBuf::from)
}

/// `CFBundleIdentifier` of the outermost `.app` holding `pid`'s executable.
pub fn bundle_id(pid: u32) -> Option<String> {
    let executable = path(pid)?;
    let app = executable
        .ancestors()
        .filter(|p| p.extension().is_some_and(|e| e == "app"))
        .last()?;
    bundle_identifier(app)
}

/// `CFBundleIdentifier` of the bundle at `app`.
pub fn bundle_identifier(app: &Path) -> Option<String> {
    let bytes = app.as_os_str().as_encoded_bytes();
    let length = isize::try_from(bytes.len()).ok()?;
    // SAFETY: `bytes` is a path of `length` bytes; the default allocator.
    let url = Owned::new(unsafe {
        cf::CFURLCreateFromFileSystemRepresentation(std::ptr::null(), bytes.as_ptr(), length, true)
    })?;
    // SAFETY: `url` is a valid CFURL.
    let bundle = Owned::new(unsafe { cf::CFBundleCreate(std::ptr::null(), url.get()) })?;
    // SAFETY: `bundle` is a valid CFBundle; the identifier is not owned (Get rule).
    cf::string(unsafe { cf::CFBundleGetIdentifier(bundle.get()) })
}
