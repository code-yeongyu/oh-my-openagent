//! The portal consent policy (card X10, decision D5): until the owner rules on persisting
//! restore tokens, `computer.wayland_persist_consent` is `false` - no token is asked for, kept
//! or written, so a Wayland hand asks its user again after every engine lifecycle. With the
//! setting on, the token lives in one 0600, owner-only, no-follow state file.

use std::io::{Read, Write};
use std::path::PathBuf;

use rustix::fs::{Mode, OFlags, Stat};

/// The state file is the engine user's own and nobody else can read or write it.
fn owner_only(stat: &Stat) -> bool {
    stat.st_uid == rustix::process::getuid().as_raw() && stat.st_mode & 0o077 == 0
}

/// The consent policy of one engine lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Consent {
    persist: bool,
    file: PathBuf,
}

impl Consent {
    #[must_use]
    pub const fn new(persist: bool, file: PathBuf) -> Self {
        Self { persist, file }
    }

    #[must_use]
    pub const fn persist(&self) -> bool {
        self.persist
    }

    /// The persisted restore token, read only when persisting is on.
    #[must_use]
    pub fn token(&self) -> Option<String> {
        if !self.persist {
            return None;
        }
        let fd = rustix::fs::open(
            &self.file,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .ok()?;
        if !owner_only(&rustix::fs::fstat(&fd).ok()?) {
            return None;
        }
        let mut token = String::new();
        std::fs::File::from(fd).read_to_string(&mut token).ok()?;
        Some(token.trim().to_owned()).filter(|token| !token.is_empty())
    }

    /// Keeps the token the portal returned - only when persisting is on, and only in an
    /// owner-only file: the 0600 mode at creation does not apply to a file that already
    /// exists, so an existing file is checked before it is truncated (review L4 of #13909).
    pub fn keep(&self, token: Option<&str>) {
        let (true, Some(token)) = (self.persist, token) else {
            return;
        };
        let flags = OFlags::WRONLY | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let written = rustix::fs::open(&self.file, flags, Mode::RUSR | Mode::WUSR)
            .map_err(std::io::Error::from)
            .and_then(|fd| {
                if !owner_only(&rustix::fs::fstat(&fd)?) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "not an owner-only 0600 file",
                    ));
                }
                rustix::fs::ftruncate(&fd, 0)?;
                std::fs::File::from(fd).write_all(token.as_bytes())
            });
        if let Err(error) = written {
            eprintln!(
                "omo-computer-backend-wayland: restore token not kept at {}: {error}",
                self.file.display()
            );
        }
    }
}
