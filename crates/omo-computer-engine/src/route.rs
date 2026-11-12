//! Backend selection from the launch environment. `OMO_COMPUTER_BACKEND=fake` selects the
//! fake over `OMO_COMPUTER_FAKE_SCENARIO`; the OS backends register here in wave 3.

use std::fmt;
use std::path::Path;

use omo_computer_backend_fake::{FakeBackend, RecordingSink, SeamError};
use omo_computer_core::backend::Backend;
use omo_computer_core::env::{check_launch_env, SeamRefusal, FAKE_BACKEND};

pub const BACKEND_SEAM: &str = "OMO_COMPUTER_BACKEND";
pub const RUNTIME_DIR_SEAM: &str = "OMO_COMPUTER_RUNTIME_DIR";
// Row 55 (R35): the value that selects the Windows backend; unset stays NoBackend (row 28).
// Off Windows only the tests read it; the cfg(windows) arm is its one non-test reader.
#[cfg_attr(not(windows), allow(dead_code))]
pub const WIN32_BACKEND: &str = "win32";

/// The fake's recording sink file under the runtime directory: `fake-sink-<pid>.log`, one
/// per engine process, so a restarted engine never truncates the lines of the one before.
pub const SINK_FILE_PREFIX: &str = "fake-sink-";

#[derive(Debug)]
pub enum RouteError {
    Seam(SeamRefusal),
    NoBackend(Option<String>),
    Fake(SeamError),
    Sink(std::io::Error),
}

impl fmt::Display for RouteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Seam(SeamRefusal::UnknownSeam { name }) => write!(f, "unknown seam {name}"),
            Self::Seam(SeamRefusal::FakeOnlySeamWithRealBackend { name }) => {
                write!(f, "{name} is honoured only with {BACKEND_SEAM}={FAKE_BACKEND}")
            }
            Self::NoBackend(value) => write!(f, "no backend is registered for {BACKEND_SEAM}={value:?}"),
            Self::Fake(error) => error.fmt(f),
            Self::Sink(error) => write!(f, "fake sink file: {error}"),
        }
    }
}

/// The backend the launch environment selects.
///
/// # Errors
/// A seam is refused, no backend is registered for the value, or the fake cannot be built.
pub fn backend(vars: &[(String, String)]) -> Result<Box<dyn Backend>, RouteError> {
    check_launch_env(vars.iter().map(|(name, value)| (name.as_str(), value.as_str())))
        .map_err(RouteError::Seam)?;
    let lookup = |name: &str| {
        vars.iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    match lookup(BACKEND_SEAM) {
        Some(value) if value == FAKE_BACKEND => {
            let sink = match lookup(RUNTIME_DIR_SEAM) {
                Some(dir) => RecordingSink::with_file(
                    &Path::new(&dir).join(format!("{SINK_FILE_PREFIX}{}.log", std::process::id())),
                )
                .map_err(RouteError::Sink)?,
                None => RecordingSink::default(),
            };
            let fake = FakeBackend::from_seams(lookup, sink).map_err(RouteError::Fake)?;
            Ok(Box::new(fake))
        }
        // Row 55 (R35): the Windows backend, on Windows only.
        #[cfg(windows)]
        Some(value) if value == WIN32_BACKEND => Ok(Box::new(omo_computer_backend_win32::Win32Backend::new())),
        other => Err(RouteError::NoBackend(other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }

    #[test]
    fn fake_is_selected_and_other_values_refuse() {
        assert!(backend(&vars(&[(BACKEND_SEAM, "fake")])).is_ok());
        assert!(matches!(backend(&vars(&[])), Err(RouteError::NoBackend(None))));
        assert!(matches!(
            backend(&vars(&[("OMO_COMPUTER_FAKE_STOP_PATH", "live")])),
            Err(RouteError::Seam(_))
        ));
        assert!(matches!(
            backend(&vars(&[(BACKEND_SEAM, "fake"), ("OMO_COMPUTER_FAKE_STOP_PATH", "loud")])),
            Err(RouteError::Fake(_))
        ));
    }

    // Row 55 (R35): OMO_COMPUTER_BACKEND=win32 selects the Windows backend on Windows and
    // nothing elsewhere; unset still selects nothing.
    #[test]
    fn win32_is_selected_only_on_windows() {
        let selected = backend(&vars(&[(BACKEND_SEAM, WIN32_BACKEND)]));
        if cfg!(windows) {
            assert_eq!(selected.map(|backend| backend.capabilities().backend).ok().as_deref(), Some("win32"));
        } else {
            assert!(matches!(selected, Err(RouteError::NoBackend(Some(value))) if value == WIN32_BACKEND));
        }
        assert!(matches!(backend(&vars(&[])), Err(RouteError::NoBackend(None))));
    }
}
