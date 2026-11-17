//! Per-process reads: the start time from `proc_pidinfo`, the app an executable belongs to,
//! its bundle id and the bundle's main executable.

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

/// The app an executable belongs to: the innermost `.app` holding it (a helper app inside
/// another bundle is its own app). The window listing and `apps.list()` share this identity.
pub fn app_bundle(executable: &Path) -> Option<&Path> {
    executable
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
}

/// `CFBundleIdentifier` of the app holding `pid`'s executable.
pub fn bundle_id(pid: u32) -> Option<String> {
    bundle_identifier(app_bundle(&path(pid)?)?)
}

/// The CFBundle at `app`.
pub fn bundle(app: &Path) -> Option<Owned> {
    let bytes = app.as_os_str().as_encoded_bytes();
    let length = isize::try_from(bytes.len()).ok()?;
    // SAFETY: `bytes` is a path of `length` bytes; the default allocator.
    let url = Owned::new(unsafe {
        cf::CFURLCreateFromFileSystemRepresentation(std::ptr::null(), bytes.as_ptr(), length, true)
    })?;
    // SAFETY: `url` is a valid CFURL; +1 bundle or null.
    Owned::new(unsafe { cf::CFBundleCreate(std::ptr::null(), url.get()) })
}

/// `CFBundleIdentifier` of the bundle at `app`.
pub fn bundle_identifier(app: &Path) -> Option<String> {
    let bundle = bundle(app)?;
    // SAFETY: `bundle` is a valid CFBundle; the identifier is not owned (Get rule).
    cf::string(unsafe { cf::CFBundleGetIdentifier(bundle.get()) })
}

/// The bundle's main executable (`CFBundleExecutable`, wherever the bundle layout puts it).
pub fn main_executable(app: &Path) -> Option<PathBuf> {
    let bundle = bundle(app)?;
    // SAFETY: `bundle` is a valid CFBundle; +1 CFURL or null.
    let url = Owned::new(unsafe { cf::CFBundleCopyExecutableURL(bundle.get()) })?;
    let mut buffer = vec![0u8; libc::PATH_MAX as usize];
    let size = isize::try_from(buffer.len()).ok()?;
    // SAFETY: `url` is a valid CFURL; the buffer holds `size` bytes and is NUL-terminated on success.
    let ok =
        unsafe { cf::CFURLGetFileSystemRepresentation(url.get(), true, buffer.as_mut_ptr(), size) };
    if !ok {
        return None;
    }
    let text = std::ffi::CStr::from_bytes_until_nul(&buffer).ok()?;
    Some(PathBuf::from(text.to_str().ok()?))
}
