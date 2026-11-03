//! Engine configuration read from the environment once, at startup.

use std::time::Duration;

use senpi_desktop_session::{BackendSelection, SelectionError, SessionTimeouts};

pub const FAKE_CLOCK_ENV: &str = "SENPI_DESKTOP_FAKE_CLOCK";
pub const OPERATION_TIMEOUT_ENV: &str = "SENPI_DESKTOP_OPERATION_TIMEOUT_MS";
pub const CLOSE_TIMEOUT_ENV: &str = "SENPI_DESKTOP_CLOSE_TIMEOUT_MS";

#[derive(Debug, Clone, PartialEq)]
pub struct EngineConfig {
    pub selection: BackendSelection,
    pub timeouts: SessionTimeouts,
    /// `SENPI_DESKTOP_FAKE_CLOCK=1`: time moves only by `$/test.advanceClock`.
    pub fake_clock: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error(transparent)]
    Backend(#[from] SelectionError),
    #[error("{name}={value} is not a whole number of milliseconds")]
    Millis { name: &'static str, value: String },
    #[error("{0} is not valid unicode")]
    NotUnicode(&'static str),
}

impl EngineConfig {
    /// # Errors
    /// A malformed `SENPI_DESKTOP_*` variable.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| match std::env::var(name) {
            Ok(value) => Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(std::env::VarError::NotUnicode(_)) => Err(ConfigError::NotUnicode(name)),
        })
    }

    fn from_lookup(
        lookup: impl Fn(&'static str) -> Result<Option<String>, ConfigError>,
    ) -> Result<Self, ConfigError> {
        let millis = |name: &'static str, default: Duration| -> Result<Duration, ConfigError> {
            let Some(value) = lookup(name)? else {
                return Ok(default);
            };
            value
                .trim()
                .parse()
                .map(Duration::from_millis)
                .map_err(|_| ConfigError::Millis { name, value })
        };
        let defaults = SessionTimeouts::default();
        Ok(Self {
            selection: BackendSelection::parse(lookup(BackendSelection::ENV)?.as_deref())?,
            timeouts: SessionTimeouts {
                operation: millis(OPERATION_TIMEOUT_ENV, defaults.operation)?,
                close: millis(CLOSE_TIMEOUT_ENV, defaults.close)?,
            },
            fake_clock: lookup(FAKE_CLOCK_ENV)?.is_some_and(|value| value.trim() == "1"),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn config(vars: &[(&str, &str)]) -> Result<EngineConfig, ConfigError> {
        EngineConfig::from_lookup(|name| {
            let value = vars
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned());
            Ok(value)
        })
    }

    #[test]
    fn an_empty_environment_selects_the_platform_backend_and_default_timeouts() {
        let config = config(&[]).unwrap();
        assert_eq!(config.selection, BackendSelection::Platform);
        assert_eq!(config.timeouts, SessionTimeouts::default());
        assert!(!config.fake_clock);
    }

    #[test]
    fn test_overrides_select_the_fake_backend_clock_and_timeouts() {
        let config = config(&[
            ("SENPI_DESKTOP_BACKEND", "fake:scenario.json"),
            ("SENPI_DESKTOP_FAKE_CLOCK", "1"),
            ("SENPI_DESKTOP_OPERATION_TIMEOUT_MS", "500"),
            ("SENPI_DESKTOP_CLOSE_TIMEOUT_MS", "250"),
        ])
        .unwrap();
        assert_eq!(
            config.selection,
            BackendSelection::FakeFile(PathBuf::from("scenario.json"))
        );
        assert!(config.fake_clock);
        assert_eq!(config.timeouts.operation, Duration::from_millis(500));
        assert_eq!(config.timeouts.close, Duration::from_millis(250));
    }

    #[test]
    fn a_malformed_timeout_is_rejected() {
        assert_eq!(
            config(&[("SENPI_DESKTOP_OPERATION_TIMEOUT_MS", "soon")]),
            Err(ConfigError::Millis {
                name: OPERATION_TIMEOUT_ENV,
                value: "soon".to_owned(),
            })
        );
    }
}
