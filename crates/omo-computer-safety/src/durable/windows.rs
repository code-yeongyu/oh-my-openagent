//! The Windows arm of the durable directory-entry writes (amendment A-IS-60 and its security
//! read, ruling R70z(3)): the directory handle opens first (backup semantics, write access) and
//! its filesystem is read from that handle (NTFS or ReFS only), so an access or filesystem failure
//! surfaces before anything changes; a rename is write-through; then the directory is flushed,
//! which is the step that makes the entry durable. Ok only when every call succeeded; any failure
//! is an error carrying its `GetLastError` code (no code reads as "unsupported, skip"); a flush
//! that fails after the rename leaves the renamed file in place; the one directory handle closes
//! on every path.

use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FlushFileBuffers, GetVolumeInformationByHandleW, MoveFileExW,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, OPEN_EXISTING,
};

use super::admit_filesystem;

/// The directory's handle, closed on every path.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful CreateFileW and is closed once, here.
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Opens `dir` for the flush and admits its filesystem (NTFS or ReFS), before anything changes.
fn open_dir(dir: &Path) -> io::Result<Owned> {
    let directory = wide(dir);
    // SAFETY: a NUL-terminated UTF-16 path that lives across the call; no security attributes
    // and no template handle.
    let handle = unsafe {
        CreateFileW(
            directory.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let directory = Owned(handle);
    // The filesystem is read from the directory's own handle, never from a drive letter, and
    // anything but NTFS or ReFS refuses before any state changes.
    let mut name = [0_u16; 64];
    // SAFETY: the handle is open; only the filesystem-name buffer is asked for, with its length.
    let read = unsafe {
        GetVolumeInformationByHandleW(
            directory.0,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            name.as_mut_ptr(),
            u32::try_from(name.len()).unwrap_or(0),
        )
    };
    let filesystem = if read == 0 {
        Err(io::Error::last_os_error())
    } else {
        let end = name.iter().position(|unit| *unit == 0).unwrap_or(name.len());
        Ok(String::from_utf16_lossy(&name[..end]))
    };
    admit_filesystem(filesystem)?;
    Ok(directory)
}

/// Flushes the directory: the step that makes its entries durable.
fn flush(directory: &Owned) -> io::Result<()> {
    // SAFETY: the directory handle is open until `directory` drops.
    if unsafe { FlushFileBuffers(directory.0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Renames `temp` over `path` in `dir` and makes the entry durable.
///
/// # Errors
/// Any step that fails, with its OS code; an unsupported filesystem.
pub fn durable_rename(temp: &Path, path: &Path, dir: &Path) -> io::Result<()> {
    let directory = open_dir(dir)?;
    let (from, to) = (wide(temp), wide(path));
    // SAFETY: both arguments are NUL-terminated UTF-16 paths that live across the call.
    let moved = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    flush(&directory)
}

/// Makes `dir`'s entries durable (after a create or a removal in it).
///
/// # Errors
/// The directory cannot be opened or flushed, with its OS code; an unsupported filesystem.
pub fn sync_dir(dir: &Path) -> io::Result<()> {
    flush(&open_dir(dir)?)
}
