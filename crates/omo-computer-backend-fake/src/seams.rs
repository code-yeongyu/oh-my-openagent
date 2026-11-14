//! Building the fake from the launch seams: `OMO_COMPUTER_FAKE_SCENARIO`,
//! `OMO_COMPUTER_FAKE_CLOCK` and `OMO_COMPUTER_FAKE_STOP_PATH`. The engine passes its
//! environment in; this crate never reads the process environment itself.

use std::fmt;
use std::path::Path;

use crate::backend::{FakeBackend, StopPathScript};
use crate::clock::{ClockSeamInvalid, FakeClock, CLOCK_SEAM};
use crate::scenario::{FakeScenario, ScenarioInvalid};
use crate::sink::RecordingSink;

pub const SCENARIO_SEAM: &str = "OMO_COMPUTER_FAKE_SCENARIO";
pub const STOP_PATH_SEAM: &str = "OMO_COMPUTER_FAKE_STOP_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeamError {
    Scenario(ScenarioInvalid),
    Clock(ClockSeamInvalid),
    StopPath { value: String },
}

impl fmt::Display for SeamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Scenario(invalid) => write!(f, "{SCENARIO_SEAM}: {invalid}"),
            Self::Clock(invalid) => invalid.fmt(f),
            Self::StopPath { value } => {
                write!(f, "{STOP_PATH_SEAM}={value:?} is not live, deaf or none")
            }
        }
    }
}

impl std::error::Error for SeamError {}

/// # Errors
/// The value is not `live`, `deaf` or `none`.
pub fn parse_stop_path(value: Option<&str>) -> Result<StopPathScript, SeamError> {
    match value {
        None | Some("none") => Ok(StopPathScript::None),
        Some("live") => Ok(StopPathScript::Live),
        Some("deaf") => Ok(StopPathScript::Deaf),
        Some(other) => Err(SeamError::StopPath {
            value: other.to_owned(),
        }),
    }
}

impl FakeBackend {
    /// The fake the seams describe; an unset scenario seam is the empty scenario.
    ///
    /// # Errors
    /// A seam value is invalid; no backend is built.
    pub fn from_seams(
        lookup: impl Fn(&str) -> Option<String>,
        sink: RecordingSink,
    ) -> Result<Self, SeamError> {
        let scenario = match lookup(SCENARIO_SEAM) {
            Some(path) => FakeScenario::load(Path::new(&path)).map_err(SeamError::Scenario)?,
            None => FakeScenario::default(),
        };
        let clock =
            FakeClock::from_seam(lookup(CLOCK_SEAM).as_deref()).map_err(SeamError::Clock)?;
        let stop_path = parse_stop_path(lookup(STOP_PATH_SEAM).as_deref())?;
        Ok(Self::with_parts(scenario, clock, sink).with_stop_path(stop_path))
    }
}

#[cfg(test)]
mod tests;
