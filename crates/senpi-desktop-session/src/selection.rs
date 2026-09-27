//! Which backend the session drives: this OS's platform backend, or the
//! scripted fake selected by `SENPI_DESKTOP_BACKEND=fake:<scenario-path>`.

use std::path::PathBuf;

use senpi_desktop_backend_fake::{FakeBackend, FakeScenario};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DisplaySelector;

/// Builds the backend on the session thread: once at start (the capabilities
/// probe) and again at every `session.open` with its display selector.
pub trait BackendFactory: Send + 'static {
    /// # Errors
    /// The reason no backend exists on this host; the session then reports
    /// `DesktopCapabilities::unavailable()` and fails every backend request
    /// with this error.
    fn create(&self, selector: DisplaySelector) -> CoreResult<Box<dyn Backend>>;
}

#[derive(Debug, Clone, PartialEq)]
pub enum BackendSelection {
    /// The backend crate for the compile target.
    Platform,
    /// The fake backend serving the scenario file at this path.
    FakeFile(PathBuf),
    /// The fake backend serving an in-memory scenario (`--selftest`).
    FakeScenario(Box<FakeScenario>),
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SelectionError {
    #[error("SENPI_DESKTOP_BACKEND=fake: needs a scenario path (fake:<scenario-path>)")]
    MissingScenarioPath,
    #[error("unknown SENPI_DESKTOP_BACKEND value '{0}'; expected fake:<scenario-path> or unset")]
    Unknown(String),
}

impl BackendSelection {
    pub const ENV: &'static str = "SENPI_DESKTOP_BACKEND";

    /// Parses the `SENPI_DESKTOP_BACKEND` value; unset or empty selects the
    /// platform backend.
    ///
    /// # Errors
    /// Any value other than `fake:<scenario-path>`.
    pub fn parse(value: Option<&str>) -> Result<Self, SelectionError> {
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(Self::Platform);
        };
        match value.strip_prefix("fake:") {
            Some("") => Err(SelectionError::MissingScenarioPath),
            Some(path) => Ok(Self::FakeFile(PathBuf::from(path))),
            None => Err(SelectionError::Unknown(value.to_owned())),
        }
    }
}

impl BackendFactory for BackendSelection {
    fn create(&self, selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
        match self {
            Self::Platform => platform_backend(selector),
            Self::FakeFile(path) => FakeScenario::load(path)
                .map(fake_backend)
                .map_err(|error| DesktopError::capture_failed(error.to_string())),
            Self::FakeScenario(scenario) => Ok(fake_backend((**scenario).clone())),
        }
    }
}

fn fake_backend(scenario: FakeScenario) -> Box<dyn Backend> {
    Box::new(FakeBackend::new(scenario))
}

/// The backend crate for the compile target.
#[cfg(target_os = "macos")]
fn platform_backend(selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
    let backend = senpi_desktop_backend_macos::MacosBackend::new(selector)?;
    Ok(Box::new(backend))
}

#[cfg(target_os = "windows")]
fn platform_backend(selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
    let backend = senpi_desktop_backend_win32::Win32Backend::new(selector)?;
    Ok(Box::new(backend))
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxDisplayServer {
    Wayland,
    X11,
}

/// `WAYLAND_DISPLAY` wins over `DISPLAY` (an XWayland session sets both).
#[cfg(target_os = "linux")]
fn linux_display_server(is_set: impl Fn(&str) -> bool) -> Option<LinuxDisplayServer> {
    if is_set("WAYLAND_DISPLAY") {
        Some(LinuxDisplayServer::Wayland)
    } else if is_set("DISPLAY") {
        Some(LinuxDisplayServer::X11)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn platform_backend(selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
    match linux_display_server(|name| std::env::var_os(name).is_some()) {
        Some(LinuxDisplayServer::Wayland) => {
            let backend = senpi_desktop_backend_wayland::WaylandBackend::new(selector);
            Ok(Box::new(backend))
        }
        Some(LinuxDisplayServer::X11) => {
            let backend = senpi_desktop_backend_x11::X11Backend::new(selector)?;
            Ok(Box::new(backend))
        }
        None => Err(DesktopError::capture_failed(
            "no display server (neither WAYLAND_DISPLAY nor DISPLAY is set)",
        )),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_backend(_selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
    Err(DesktopError::capture_failed(format!(
        "{} desktop backend not yet ported",
        std::env::consts::OS
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_blank_selects_the_platform_backend() {
        assert_eq!(BackendSelection::parse(None), Ok(BackendSelection::Platform));
        assert_eq!(
            BackendSelection::parse(Some("  ")),
            Ok(BackendSelection::Platform)
        );
    }

    #[test]
    fn fake_prefix_selects_the_scenario_file() {
        assert_eq!(
            BackendSelection::parse(Some("fake:fixtures/a.json")),
            Ok(BackendSelection::FakeFile(PathBuf::from("fixtures/a.json")))
        );
    }

    #[test]
    fn fake_without_path_and_unknown_values_are_rejected() {
        assert_eq!(
            BackendSelection::parse(Some("fake:")),
            Err(SelectionError::MissingScenarioPath)
        );
        assert_eq!(
            BackendSelection::parse(Some("quartz")),
            Err(SelectionError::Unknown("quartz".to_owned()))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_prefers_wayland_then_x11_and_needs_one_of_them() {
        let with = |set: &'static [&'static str]| linux_display_server(move |name| set.contains(&name));

        let picks = [
            with(&["WAYLAND_DISPLAY", "DISPLAY"]),
            with(&["WAYLAND_DISPLAY"]),
            with(&["DISPLAY"]),
            with(&[]),
        ];

        assert_eq!(
            picks,
            [
                Some(LinuxDisplayServer::Wayland),
                Some(LinuxDisplayServer::Wayland),
                Some(LinuxDisplayServer::X11),
                None,
            ]
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    #[test]
    fn platform_backend_is_not_yet_ported() {
        let error = BackendSelection::Platform
            .create(DisplaySelector::All)
            .err()
            .map(|error| error.code);
        assert_eq!(error, Some(senpi_desktop_core::error::ErrorCode::CaptureFailed));
    }
}
