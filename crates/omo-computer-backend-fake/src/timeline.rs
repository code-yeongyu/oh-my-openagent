//! The timelines a scenario scripts against the fake clock: loading indicators, observer events
//! and user input. Times are milliseconds after backend creation.

use crate::scenario::{AxNotification, BusyMark, TimedUserInput, UserInputKind};

/// Whether a window shows a loading indicator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadingState {
    /// The scenario scripts no indicators: the backend cannot tell.
    Unknown,
    Idle,
    Busy {
        indicator: Option<String>,
    },
}

#[must_use]
pub fn loading_state(marks: &[BusyMark], window: &str, elapsed_ms: u64) -> LoadingState {
    if marks.is_empty() {
        return LoadingState::Unknown;
    }
    marks
        .iter()
        .filter(|mark| mark.window == window && mark.t_ms <= elapsed_ms)
        .max_by_key(|mark| mark.t_ms)
        .map_or(LoadingState::Idle, |mark| {
            if mark.busy {
                LoadingState::Busy {
                    indicator: mark.indicator.clone(),
                }
            } else {
                LoadingState::Idle
            }
        })
}

/// The index of the next notification due at `elapsed_ms`, at or after `from`.
#[must_use]
pub fn next_due(timeline: &[AxNotification], from: usize, elapsed_ms: u64) -> Option<usize> {
    timeline
        .get(from..)?
        .iter()
        .position(|event| event.t_ms <= elapsed_ms)
        .map(|offset| from + offset)
}

/// One user input the fake's feed reports, at an absolute fake-clock time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInput {
    pub at_ms: i64,
    pub pid: u32,
    pub kind: UserInputKind,
}

/// The scripted timeline as absolute times from the clock's start.
#[must_use]
pub fn absolute(timeline: &[TimedUserInput], start_ms: u64) -> Vec<UserInput> {
    let start = i64::try_from(start_ms).unwrap_or(i64::MAX);
    timeline
        .iter()
        .map(|input| UserInput {
            at_ms: start.saturating_add(input.t_ms),
            pid: input.pid,
            kind: input.kind,
        })
        .collect()
}

#[cfg(test)]
mod tests;
