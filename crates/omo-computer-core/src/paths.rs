//! The ONE resolver of the per-uid roots every engine mode and transport reads: the STATE
//! root (persistent: the `global-stop` marker, the resume token, audit, artifacts) and the
//! RUNTIME root (sockets, locks and pre-input markers; dies with the login session). Both
//! engines of one machine resolve the same two paths, so they read one marker.
//!
//! `OMO_COMPUTER_RUNTIME_DIR` (a test seam) moves both roots into one test directory.

use std::fmt;
#[cfg(any(unix, test))]
use std::path::Path;
use std::path::PathBuf;

/// The stop marker's file name under the STATE root.
pub const STOP_MARKER_FILE: &str = "global-stop";

/// The seam that moves the marker and stop files into a test directory.
pub const RUNTIME_DIR_SEAM: &str = "OMO_COMPUTER_RUNTIME_DIR";

/// The two per-uid roots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Roots {
    pub state: PathBuf,
    pub runtime: PathBuf,
}

impl Roots {
    /// `global-stop` under the STATE root.
    #[must_use]
    pub fn stop_marker(&self) -> PathBuf {
        self.state.join(STOP_MARKER_FILE)
    }
}

/// Why no root resolves: the engine does not start without one (never a shared `/tmp`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootsUnavailable {
    /// The user database has no home directory for the effective uid.
    NoHome,
    /// No per-user runtime directory exists for the effective uid.
    NoRuntimeDir,
    /// `%LOCALAPPDATA%` is unset.
    NoLocalAppData,
}

impl fmt::Display for RootsUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoHome => f.write_str("the effective uid has no home directory"),
            Self::NoRuntimeDir => f.write_str("the effective uid has no runtime directory"),
            Self::NoLocalAppData => f.write_str("LOCALAPPDATA is unset"),
        }
    }
}

impl std::error::Error for RootsUnavailable {}

/// The roots for the current effective user; `lookup` reads the environment.
///
/// # Errors
/// No home, runtime directory or local application data directory can be named.
pub fn resolve(lookup: impl Fn(&str) -> Option<String>) -> Result<Roots, RootsUnavailable> {
    if let Some(dir) = lookup(RUNTIME_DIR_SEAM).filter(|dir| !dir.is_empty()) {
        let dir = PathBuf::from(dir);
        return Ok(Roots {
            state: dir.clone(),
            runtime: dir,
        });
    }
    os::resolve(&lookup)
}

/// An absolute path from the environment, or `None` (a relative value is ignored). macOS
/// resolves its roots without the environment, so only the other targets use it.
#[cfg(not(target_os = "macos"))]
fn absolute(lookup: &impl Fn(&str) -> Option<String>, name: &str) -> Option<PathBuf> {
    lookup(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

#[cfg(unix)]
fn per_uid(base: &Path) -> PathBuf {
    base.join("omo-computer").join(unix::euid().to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
mod os {
    use super::{absolute, per_uid, unix, PathBuf, Roots, RootsUnavailable};

    pub(super) fn resolve(
        lookup: &impl Fn(&str) -> Option<String>,
    ) -> Result<Roots, RootsUnavailable> {
        let state_base = match absolute(lookup, "XDG_STATE_HOME") {
            Some(dir) => dir,
            None => unix::home()
                .ok_or(RootsUnavailable::NoHome)?
                .join(".local/state"),
        };
        let runtime_base = match absolute(lookup, "XDG_RUNTIME_DIR") {
            Some(dir) => dir,
            None => {
                let dir = PathBuf::from(format!("/run/user/{}", unix::euid()));
                if !dir.is_dir() {
                    return Err(RootsUnavailable::NoRuntimeDir);
                }
                dir
            }
        };
        Ok(Roots {
            state: state_base.join("omo").join("computer-control"),
            runtime: per_uid(&runtime_base),
        })
    }
}

#[cfg(target_os = "macos")]
mod os {
    use super::{per_uid, unix, Roots, RootsUnavailable};

    pub(super) fn resolve(
        _lookup: &impl Fn(&str) -> Option<String>,
    ) -> Result<Roots, RootsUnavailable> {
        let home = unix::home().ok_or(RootsUnavailable::NoHome)?;
        let temp = unix::darwin_user_temp_dir().ok_or(RootsUnavailable::NoRuntimeDir)?;
        Ok(Roots {
            state: home.join("Library/Application Support/OmO/ComputerControl/1"),
            runtime: per_uid(&temp),
        })
    }
}

#[cfg(windows)]
mod os {
    use super::{absolute, Roots, RootsUnavailable};

    pub(super) fn resolve(
        lookup: &impl Fn(&str) -> Option<String>,
    ) -> Result<Roots, RootsUnavailable> {
        let base = absolute(lookup, "LOCALAPPDATA").ok_or(RootsUnavailable::NoLocalAppData)?;
        let state = base.join("OmO").join("ComputerControl");
        // Windows keeps its sockets and locks in the per-SID named-object namespace; the
        // file-backed runtime entries (the published endpoint) sit beside the marker.
        Ok(Roots {
            runtime: state.clone(),
            state,
        })
    }
}

#[cfg(unix)]
mod unix {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    use std::path::PathBuf;

    pub(super) fn euid() -> u32 {
        // SAFETY: geteuid has no preconditions and cannot fail.
        unsafe { libc::geteuid() }
    }

    /// The home directory from the user database (`getpwuid_r`), never from `$HOME`.
    pub(super) fn home() -> Option<PathBuf> {
        let mut buffer = vec![0_u8; 16 * 1024];
        // SAFETY: an all-zero passwd is a valid value for an out-parameter of getpwuid_r.
        let mut record: libc::passwd = unsafe { std::mem::zeroed() };
        let mut found: *mut libc::passwd = std::ptr::null_mut();
        // SAFETY: every pointer refers to a live, writable buffer of the stated length.
        let status = unsafe {
            libc::getpwuid_r(
                euid(),
                &raw mut record,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &raw mut found,
            )
        };
        if status != 0 || found.is_null() || record.pw_dir.is_null() {
            return None;
        }
        // SAFETY: getpwuid_r succeeded, so pw_dir points at a NUL-terminated string in buffer.
        let dir = unsafe { CStr::from_ptr(record.pw_dir) };
        let path = PathBuf::from(std::ffi::OsStr::from_bytes(dir.to_bytes()));
        path.is_absolute().then_some(path)
    }

    /// `confstr(_CS_DARWIN_USER_TEMP_DIR)`: the per-user temporary directory, never `$TMPDIR`.
    #[cfg(target_os = "macos")]
    pub(super) fn darwin_user_temp_dir() -> Option<PathBuf> {
        let mut buffer = vec![0_u8; 1024];
        // SAFETY: the buffer is writable for its full length.
        let written = unsafe {
            libc::confstr(
                libc::_CS_DARWIN_USER_TEMP_DIR,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
            )
        };
        if written == 0 || written > buffer.len() {
            return None;
        }
        let dir = CStr::from_bytes_until_nul(&buffer).ok()?;
        Some(PathBuf::from(std::ffi::OsStr::from_bytes(dir.to_bytes())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_runtime_seam_moves_both_roots_and_the_marker_lives_under_state() {
        let roots = resolve(|name| (name == RUNTIME_DIR_SEAM).then(|| "/tmp/omo-test".to_owned()))
            .expect("the seam resolves");
        assert_eq!(roots.state, Path::new("/tmp/omo-test"));
        assert_eq!(roots.runtime, Path::new("/tmp/omo-test"));
        assert_eq!(roots.stop_marker(), Path::new("/tmp/omo-test/global-stop"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn linux_roots_follow_the_xdg_layout_and_ignore_relative_values() {
        let roots = resolve(|name| match name {
            "XDG_STATE_HOME" => Some("/state".to_owned()),
            "XDG_RUNTIME_DIR" => Some("/run/x".to_owned()),
            _ => None,
        })
        .expect("resolves");
        assert_eq!(roots.state, Path::new("/state/omo/computer-control"));
        assert_eq!(
            roots.runtime,
            Path::new("/run/x/omo-computer").join(unix::euid().to_string())
        );
        let relative = resolve(|name| match name {
            "XDG_STATE_HOME" => Some("relative".to_owned()),
            "XDG_RUNTIME_DIR" => Some("/run/x".to_owned()),
            _ => None,
        })
        .expect("resolves");
        assert!(relative.state.is_absolute(), "{:?}", relative.state);
        assert!(relative
            .state
            .ends_with(".local/state/omo/computer-control"));
    }
}
