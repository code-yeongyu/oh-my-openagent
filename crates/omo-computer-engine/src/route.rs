//! Backend selection from the launch environment. `OMO_COMPUTER_BACKEND=fake` selects the
//! fake over `OMO_COMPUTER_FAKE_SCENARIO`; the OS backends register here in wave 3.

use std::fmt;
use std::path::Path;

use omo_computer_backend_fake::{FakeBackend, RecordingSink, SeamError};
use omo_computer_core::backend::Backend;
use omo_computer_core::env::{check_launch_env, SeamRefusal, FAKE_BACKEND};
use omo_computer_core::report::Platform;
use omo_computer_session::grant::declares_compile_target;

pub const BACKEND_SEAM: &str = "OMO_COMPUTER_BACKEND";
pub const RUNTIME_DIR_SEAM: &str = "OMO_COMPUTER_RUNTIME_DIR";

/// The fake's recording sink file under the runtime directory: `fake-sink-<pid>.log`, one
/// per engine process, so a restarted engine never truncates the lines of the one before.
pub const SINK_FILE_PREFIX: &str = "fake-sink-";

#[derive(Debug)]
pub enum RouteError {
    Seam(SeamRefusal),
    NoBackend(Option<String>),
    Fake(SeamError),
    Sink(std::io::Error),
    /// A-IS-64 (b): a non-fake backend that declares another OS than the engine's compile target.
    PlatformMismatch { declared: Option<Platform> },
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
            Self::PlatformMismatch { declared } => write!(
                f,
                "the backend declares {declared:?}, the engine is built for {}: no session opens",
                std::env::consts::OS
            ),
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
        Some(value) if selection(&value) == Selected::Fake => {
            let sink = match lookup(RUNTIME_DIR_SEAM) {
                Some(dir) => RecordingSink::with_file(
                    &Path::new(&dir).join(format!("{SINK_FILE_PREFIX}{}.log", std::process::id())),
                )
                .map_err(RouteError::Sink)?,
                None => RecordingSink::default(),
            };
            let fake = FakeBackend::from_seams(lookup, sink).map_err(RouteError::Fake)?;
            launch_gate(Selected::Fake, &fake)?;
            Ok(Box::new(fake))
        }
        // Row 47: the X11 backend on Linux, over the display `DISPLAY` names.
        #[cfg(target_os = "linux")]
        Some(value) if value == omo_computer_backend_x11::X11_BACKEND => Ok(Box::new(
            omo_computer_backend_x11::X11Backend::from_env(
                lookup("DISPLAY").as_deref(),
                lookup("GDK_SCALE").as_deref(),
            ),
        )),
        // Row 51: the Wayland backend on Linux: libei input through `LIBEI_SOCKET` or the portal.
        #[cfg(target_os = "linux")]
        Some(value) if value == omo_computer_backend_wayland::WAYLAND_BACKEND => {
            Ok(Box::new(omo_computer_backend_wayland::WaylandBackend::from_env(&lookup)))
        }
        other => Err(RouteError::NoBackend(other)),
    }
}

/// Which backend the launch environment selected: decided by the route, never by anything the
/// backend reports about itself (A-IS-64 (b), the LEAD's condition).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Selected {
    Fake,
    Real,
}

/// The selection a `OMO_COMPUTER_BACKEND` value makes: `fake` is the fake, any other value names a
/// real backend (registered by the OS rows; until then the route answers `NoBackend`).
#[must_use]
pub fn selection(value: &str) -> Selected {
    if value == FAKE_BACKEND {
        Selected::Fake
    } else {
        Selected::Real
    }
}

/// The launch gate (A-IS-64 (b)): a backend the route SELECTED as real opens no session when its
/// declared platform maps to another OS than the engine's compile target; the fake is exempt by
/// its selection, and a real backend declaring no platform takes the compile target's table.
///
/// # Errors
/// [`RouteError::PlatformMismatch`] naming both values.
pub fn launch_gate(selected: Selected, backend: &dyn Backend) -> Result<(), RouteError> {
    match selected {
        Selected::Real if !declares_compile_target(backend) => Err(RouteError::PlatformMismatch {
            declared: backend.platform(),
        }),
        Selected::Real | Selected::Fake => Ok(()),
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

    #[cfg(target_os = "linux")]
    #[test]
    fn x11_is_selected_on_linux_and_unset_stays_no_backend() {
        let mut x11 = backend(&vars(&[(BACKEND_SEAM, "x11")])).expect("x11 backend");
        assert_eq!(
            x11.displays().unwrap_err(),
            omo_computer_core::backend::Refusal::new(
                omo_computer_core::error::EngineCode::Internal,
                omo_computer_core::error::Reason::NoDisplayServer,
            )
        );
        assert!(matches!(backend(&vars(&[])), Err(RouteError::NoBackend(None))));
    }

    use omo_computer_backend_fake::Persona;

    fn playing(persona: Persona) -> FakeBackend {
        FakeBackend::from_json("{}").expect("empty scenario").with_persona(persona)
    }

    /// A-IS-64 test 6: a non-fake backend declaring another OS fails the launch gate, naming both.
    #[test]
    fn a_real_backend_declaring_another_os_fails_the_launch_gate() {
        let other = Persona::ALL
            .into_iter()
            .map(playing)
            .find(|backend| !declares_compile_target(backend))
            .expect("a persona of another OS");
        let refused = launch_gate(Selected::Real, &other).expect_err("mismatch");
        let text = refused.to_string();
        assert!(matches!(refused, RouteError::PlatformMismatch { declared: Some(_) }), "{text}");
        assert!(text.contains(std::env::consts::OS), "{text}");
    }

    /// The LEAD's condition: a backend SELECTED as real is gated whatever it reports about itself,
    /// and only the route's selection (never a declaration) exempts the fake.
    #[test]
    fn a_backend_selected_as_real_is_gated_whatever_it_reports_about_itself() {
        for persona in Persona::ALL {
            let backend = playing(persona);
            let real = launch_gate(Selected::Real, &backend);
            assert_eq!(real.is_ok(), declares_compile_target(&backend), "{persona:?}");
            assert!(launch_gate(Selected::Fake, &backend).is_ok(), "{persona:?}");
        }
    }
}
