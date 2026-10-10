//! Removal of the world-readable `RemoteDesktop` restore token that
//! oh-my-pi builds before its #7884 wrote during read-only calls
//! (oh-my-pi portal.rs:31-58). Nothing reads it; the RemoteDesktop session
//! here is never persisted.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const ORPHANED_REMOTE_DESKTOP_TOKEN: &str = "remote-desktop-token";

/// `$XDG_STATE_HOME/omp` or `~/.local/state/omp`, where the token was written.
fn omp_state_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))?;
    Some(base.join("omp"))
}

/// Deletes the token in `dir`. A missing file is success, so it is safe to
/// call on every backend construction.
///
/// # Errors
/// Any removal failure other than the file being absent.
fn remove_token_in(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(dir.join(ORPHANED_REMOTE_DESKTOP_TOKEN)) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

/// Best-effort: a token that cannot be removed is reported on stderr and the
/// backend still starts.
pub fn remove_orphaned_remote_desktop_token() {
    let Some(dir) = omp_state_dir() else {
        return;
    };
    if let Err(error) = remove_token_in(&dir) {
        eprintln!(
            "senpi-desktop-backend-wayland: cannot remove orphaned RemoteDesktop token in {}: {error}",
            dir.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// oh-my-pi's `removes_orphaned_remote_desktop_token`, plus the absent-file case.
    #[test]
    fn removes_orphaned_remote_desktop_token_and_tolerates_its_absence() {
        let dir = tempfile::tempdir().expect("token test dir");
        let token = dir.path().join(ORPHANED_REMOTE_DESKTOP_TOKEN);
        std::fs::write(&token, "cafef00d").expect("plant orphaned token");

        let first = remove_token_in(dir.path());
        let second = remove_token_in(dir.path());

        assert!(first.is_ok() && !token.exists(), "orphaned token must be removed");
        assert!(second.is_ok(), "a missing token is not an error");
    }
}
