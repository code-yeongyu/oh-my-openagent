//! replayd capture-consent probe (P8, measure first). macOS 15+ records the
//! one-time screen-capture approval in replayd's group container; this probe
//! only reports whether that store is present, absent or unreadable. It never
//! gates a capture, and it runs only when `SENPI_DESKTOP_CAPTURE_CONSENT_PROBE=1`
//! asks for it, because reading another app's group container may itself
//! raise a macOS prompt (that is what the live measurement settles).

use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::Once;

const APPROVALS: &str = "Library/Group Containers/group.com.apple.replayd/ScreenCaptureApprovals.plist";
const PROBE_ENV: &str = "SENPI_DESKTOP_CAPTURE_CONSENT_PROBE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaptureConsent {
    Present,
    Absent,
    Unreadable,
}

impl CaptureConsent {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Present => "present",
            Self::Absent => "absent",
            Self::Unreadable => "unreadable",
        }
    }
}

pub(crate) fn approvals_path(home: &Path) -> PathBuf {
    home.join(APPROVALS)
}

/// Reads the whole approvals file at `path`; never prompts by itself, never fails.
pub(crate) fn probe_at(path: &Path) -> CaptureConsent {
    let read = std::fs::File::open(path).and_then(|mut file| {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map(|_| ())
    });
    match read {
        Ok(()) => CaptureConsent::Present,
        Err(error) if error.kind() == ErrorKind::NotFound => CaptureConsent::Absent,
        Err(_) => CaptureConsent::Unreadable,
    }
}

/// Logs the probe once per engine process when the opt-in variable is `1`.
pub(crate) fn log_once_if_requested() {
    static ONCE: Once = Once::new();
    if std::env::var_os(PROBE_ENV).is_none_or(|value| value != "1") {
        return;
    }
    ONCE.call_once(|| {
        let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) else {
            eprintln!("senpi-desktop-backend-macos: capture: replayd consent=unreadable (HOME is unset)");
            return;
        };
        let consent = probe_at(&approvals_path(Path::new(&home)));
        eprintln!("senpi-desktop-backend-macos: capture: replayd consent={}", consent.name());
    });
}

#[cfg(test)]
mod tests {
    use super::{approvals_path, probe_at, CaptureConsent};

    #[test]
    fn a_readable_approvals_file_is_present() {
        let home = tempfile::tempdir().unwrap();
        let path = approvals_path(home.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"bplist00").unwrap();
        assert_eq!(probe_at(&path), CaptureConsent::Present);
    }

    #[test]
    fn a_missing_approvals_file_is_absent() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(probe_at(&approvals_path(home.path())), CaptureConsent::Absent);
    }

    #[test]
    fn an_approvals_path_that_cannot_be_read_is_unreadable() {
        let home = tempfile::tempdir().unwrap();
        let path = approvals_path(home.path());
        std::fs::create_dir_all(&path).unwrap();
        assert_eq!(probe_at(&path), CaptureConsent::Unreadable);
    }
}
