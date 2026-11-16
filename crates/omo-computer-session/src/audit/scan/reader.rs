//! The bounded reading of one audit file (A-IS-62 R7-7): a stat before any byte is read, then
//! one pass from a kept offset, one line at a time, never holding more than one line of at most
//! `max_event` plus its stamp, and counting every byte and every open.

use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use super::{ScanStats, Tamper};

/// What a stamped line may add to `max_event`; a longer line reads tampered.
pub const LINE_STAMP_BYTES: u64 = 4 * 1024;

/// A file's identity across a rename (a rotation keeps it; a rewrite does not).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct FileId(u64, u64);

/// A present audit file: its identity and its length at the stat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Seen {
    pub(super) id: FileId,
    pub(super) len: u64,
}

#[cfg(unix)]
fn id_of(_path: &Path, meta: &fs::Metadata) -> Result<FileId, Tamper> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileId(meta.dev(), meta.ino()))
}

/// Windows: the volume serial and file index of an open handle (a creation time would not do:
/// file-name tunneling hands a new file the creation time of the one renamed away).
#[cfg(windows)]
fn id_of(path: &Path, _meta: &fs::Metadata) -> Result<FileId, Tamper> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let file = File::open(path).map_err(|_| Tamper::Unreadable)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the handle is open for the call and `info` is a live, writable out-parameter.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &raw mut info) } == 0 {
        return Err(Tamper::Unreadable);
    }
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Ok(FileId(u64::from(info.dwVolumeSerialNumber), index))
}

#[cfg(not(any(unix, windows)))]
fn id_of(_path: &Path, _meta: &fs::Metadata) -> Result<FileId, Tamper> {
    Err(Tamper::Unreadable)
}

/// The identity of the regular file at `path` (tests use it to tell rotations apart).
#[cfg(test)]
pub(crate) fn identity(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::symlink_metadata(path).ok()?;
    id_of(path, &meta).ok().map(|FileId(a, b)| (a, b))
}

/// Stats `path` without following a link: `None` when it is absent; a link, a non-regular
/// file, a file that cannot be stat'd or one over `cap` is tampered, with nothing read.
pub(super) fn stat(path: &Path, cap: u64) -> Result<Option<Seen>, Tamper> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Tamper::Unreadable),
    };
    if !meta.file_type().is_file() {
        return Err(Tamper::NotRegular);
    }
    if meta.len() > cap {
        return Err(Tamper::OverCap);
    }
    Ok(Some(Seen {
        id: id_of(path, &meta)?,
        len: meta.len(),
    }))
}

/// Reads `path` from `from` to its end, one complete line at a time into `line`, holding at most
/// `max_line` bytes; answers the offset reached. A line over the bound, a last line without its
/// newline or a file that cannot be read is tampered.
pub(super) fn read_lines(
    path: &Path,
    from: u64,
    max_line: u64,
    stats: &mut ScanStats,
    mut line: impl FnMut(&[u8]) -> Result<(), Tamper>,
) -> Result<u64, Tamper> {
    let mut file = File::open(path).map_err(|_| Tamper::Unreadable)?;
    stats.opened += 1;
    file.seek(SeekFrom::Start(from)).map_err(|_| Tamper::Unreadable)?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let max = usize::try_from(max_line).unwrap_or(usize::MAX);
    let mut buffer: Vec<u8> = Vec::new();
    let mut offset = from;
    loop {
        let available = reader.fill_buf().map_err(|_| Tamper::Unreadable)?;
        if available.is_empty() {
            return if buffer.is_empty() { Ok(offset) } else { Err(Tamper::Unparseable) };
        }
        let (take, done) = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or((available.len(), false), |at| (at + 1, true));
        let body = if done { take - 1 } else { take };
        if buffer.len() + body > max {
            return Err(Tamper::LongLine);
        }
        buffer.extend_from_slice(&available[..body]);
        stats.largest_line = stats.largest_line.max(buffer.capacity() as u64);
        reader.consume(take);
        stats.bytes_read += take as u64;
        offset += take as u64;
        if done {
            line(&buffer)?;
            buffer.clear();
        }
    }
}
