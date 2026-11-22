//! The Windows arm of the durable directory-entry writes (amendment A-IS-60 and its security
//! read, ruling R70z(3)): the directory handle opens first (backup semantics, write access) and
//! its volume is read from that handle (a local NTFS or ReFS volume only, A-IS-65 L9), so an access or filesystem failure
//! surfaces before anything changes; a rename is write-through; then the directory is flushed,
//! which is the step that makes the entry durable. Ok only when every call succeeded; any failure
//! is an error carrying its `GetLastError` code (no code reads as "unsupported, skip"); a flush
//! that fails after the rename leaves the renamed file in place; the one directory handle closes
//! on every path. The same volume admission serves the session crate's lock files
//! (`admit_volume`).

use std::fs::File;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Wdk::Storage::FileSystem::{FileFsDeviceInformation, NtQueryVolumeInformationFile};
use windows_sys::Wdk::System::SystemServices::{FILE_FS_DEVICE_INFORMATION, FILE_REMOTE_DEVICE};
use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FlushFileBuffers, GetVolumeInformationByHandleW, MoveFileExW,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, OPEN_EXISTING,
};

use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

use super::{admit_filesystem, Volume};

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

/// The filesystem's name of the volume `handle` is on, read from the handle itself.
fn filesystem(handle: HANDLE) -> io::Result<String> {
    let mut name = [0_u16; 64];
    // SAFETY: the handle is open; only the filesystem-name buffer is asked for, with its length.
    let read = unsafe {
        GetVolumeInformationByHandleW(
            handle,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            name.as_mut_ptr(),
            u32::try_from(name.len()).unwrap_or(0),
        )
    };
    if read == 0 {
        return Err(io::Error::last_os_error());
    }
    let end = name.iter().position(|unit| *unit == 0).unwrap_or(name.len());
    Ok(String::from_utf16_lossy(&name[..end]))
}

/// Whether the volume `handle` is on is a remote device (`FILE_REMOTE_DEVICE`).
fn remote(handle: HANDLE) -> io::Result<bool> {
    let mut status = IO_STATUS_BLOCK::default();
    let mut device = FILE_FS_DEVICE_INFORMATION::default();
    let length = u32::try_from(std::mem::size_of::<FILE_FS_DEVICE_INFORMATION>()).unwrap_or(0);
    // SAFETY: the handle is open; both out-parameters are live, writable and of the stated size.
    let code = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut status,
            (&raw mut device).cast(),
            length,
            FileFsDeviceInformation,
        )
    };
    if code < 0 {
        return Err(io::Error::other(format!(
            "the volume's device information is unreadable (NTSTATUS {code:#010x})"
        )));
    }
    Ok(device.Characteristics & FILE_REMOTE_DEVICE != 0)
}

/// Admits the volume `handle` is on, read from the handle: local, NTFS or ReFS (L9).
fn admit_handle(handle: HANDLE) -> io::Result<()> {
    admit_filesystem(filesystem(handle).and_then(|filesystem| {
        Ok(Volume {
            filesystem,
            remote: remote(handle)?,
        })
    }))
}

/// Admits the volume `file` is on: a local NTFS or ReFS volume (A-IS-65 L9).
///
/// # Errors
/// The volume is remote, has another filesystem, or cannot be read.
pub fn admit_volume(file: &File) -> io::Result<()> {
    admit_handle(file.as_raw_handle())
}

/// Opens `dir` for the flush and admits its volume, before anything changes.
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
    // The volume is read from the directory's own handle, never from a drive letter, and
    // anything but a local NTFS or ReFS volume refuses before any state changes.
    admit_handle(directory.0)?;
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
