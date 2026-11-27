//! Session colour allocation at open, shared by engine processes on the owning host.

use std::io::{self, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::look::CursorLook;
use crate::lock::{file, open_runtime_lock};

#[derive(Default)]
pub(crate) enum Palette {
    #[default]
    InMemory,
    Host(PathBuf),
}

impl Palette {
    pub(crate) fn register(&self) -> io::Result<&'static str> {
        static ORDINAL: AtomicUsize = AtomicUsize::new(0);
        let colours = &CursorLook::shipped().session_colours;
        let slot = match self {
            Self::InMemory => ORDINAL.fetch_add(1, Ordering::Relaxed) % colours.len(),
            Self::Host(runtime) => next_on_host(runtime, colours.len())?,
        };
        Ok(colours[slot].as_str())
    }
}

fn next_on_host(runtime: &Path, count: usize) -> io::Result<usize> {
    let counter = open_runtime_lock(&runtime.join("cursor-palette.lock"))?;
    if !counter.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "cursor palette is not a regular file",
        ));
    }
    let held = file::lock(counter)?;
    let mut counter = held.file();
    // Store only the ordinal modulo palette size. The file is empty before the first open.
    let mut byte = [0];
    match counter.read_exact(&mut byte) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {}
        Err(error) => return Err(error),
    }
    let slot = usize::from(byte[0]);
    if slot >= count {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid cursor palette slot",
        ));
    }
    let next = u8::try_from((slot + 1) % count).map_err(io::Error::other)?;
    counter.rewind()?;
    counter.write_all(&[next])?;
    Ok(slot)
}
