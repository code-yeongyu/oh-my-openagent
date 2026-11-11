//! Timelines.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadingState {
    Unknown,
    Idle,
    Busy { indicator: Option<String> },
}

#[cfg(test)]
mod tests;
