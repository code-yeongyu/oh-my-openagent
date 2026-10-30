//! Filesystem boundary for a monotonic, private stopped marker.
use std::{
    ffi::{CStr, CString},
    fs::{self, DirBuilder, File, Metadata, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    os::fd::{AsRawFd, FromRawFd},
    path::Path,
};

#[cfg(test)]
pub(super) const MARKER: &str = "global-stop";
const STOPPED: &[u8] = b"omo-global-stop-v1\n";

pub(super) fn validate(metadata: &Metadata, uid: u32, mode: u32) -> io::Result<()> {
    if metadata.uid() != uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "stop state has wrong owner",
        ));
    }
    if metadata.mode() & 0o7777 != mode {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "stop state has wrong permissions",
        ));
    }
    Ok(())
}

fn create_directory(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("state directory has no parent"))?;
    create_directory(parent)?;
    match DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => File::open(parent)?.sync_all(),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

pub(super) fn directory(path: &Path, uid: u32) -> io::Result<File> {
    create_directory(path)?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)?;
    validate(&directory.metadata()?, uid, 0o700)?;
    Ok(directory)
}

fn open_at(directory: &File, name: &CStr, flags: i32) -> io::Result<File> {
    // SAFETY: directory owns a validated live fd; name is NUL terminated.
    let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags | libc::O_CLOEXEC, 0o600) };
    if fd < 0 { return Err(io::Error::last_os_error()); }
    // SAFETY: successful openat transfers this unique descriptor to File.
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(super) fn read(directory: &File, uid: u32) -> io::Result<bool> {
    let file = match open_at(directory, c"global-stop", libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK)
    {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::other("stop marker is not a regular file"));
    }
    validate(&metadata, uid, 0o600)?;
    let mut content = Vec::new();
    file.take(64).read_to_end(&mut content)?;
    if content != STOPPED {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "malformed stop marker",
        ));
    }
    Ok(true)
}

pub(super) fn commit(path: &Path, uid: u32) -> io::Result<()> {
    let directory = directory(path, uid)?;
    commit_at(&directory)
}

pub(super) fn commit_at(directory: &File) -> io::Result<()> {
    let temporary = CString::new(format!(".global-stop-{}.tmp", ulid::Ulid::generate()))
        .map_err(io::Error::other)?;
    let mut file = open_at(directory, &temporary, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW)?;
    let committed = (|| {
        file.write_all(STOPPED)?;
        file.sync_all()?;
        // SAFETY: both names and the held directory descriptor remain live.
        if unsafe { libc::renameat(directory.as_raw_fd(), temporary.as_ptr(), directory.as_raw_fd(), c"global-stop".as_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        directory.sync_all()
    })();
    if committed.is_err() {
        // SAFETY: remove only our exclusive temporary entry in the same directory.
        if unsafe { libc::unlinkat(directory.as_raw_fd(), temporary.as_ptr(), 0) } != 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!("senpi-desktop-engine: stop temp cleanup failed: {error}");
            }
        }
    }
    committed
}
