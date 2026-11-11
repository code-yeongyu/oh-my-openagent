//! The reader of `session.open`: the v1 session keys and the settings table.

use super::settings::{read_settings, SessionConfig};
use crate::params::{OnOff, ReportMode, SessionOpenParams};
use crate::settings::{FullLiteral, Intervention, Trace};

/// What the trace writer records: nothing, the JSONL trace, or the full session manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceMode {
    Off,
    Jsonl,
    Full,
}

/// `trace`: `false` writes nothing, `true` the JSONL trace only, `"full"` the manifest too.
#[must_use]
pub const fn read_trace(trace: Trace) -> TraceMode {
    match trace {
        Trace::Enabled(false) => TraceMode::Off,
        Trace::Enabled(true) => TraceMode::Jsonl,
        Trace::Full(FullLiteral::Full) => TraceMode::Full,
    }
}

/// `macosKeyPriming`: whether background keys first make the target window key.
#[must_use]
pub const fn read_key_priming(priming: OnOff) -> bool {
    matches!(priming, OnOff::On)
}

/// The session the engine opens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionOpenRequest {
    /// `null` keeps every v1 reply byte-identical; omitted reads as `null`.
    pub report_mode: ReportMode,
    pub intervention: Option<Intervention>,
    pub key_priming: Option<bool>,
    pub trace: Option<TraceMode>,
    pub show_cursor: Option<bool>,
    pub allow_host_relay_only_stop: Option<bool>,
    pub config: Option<SessionConfig>,
}

#[must_use]
pub fn read_session_open(params: SessionOpenParams) -> SessionOpenRequest {
    let SessionOpenParams {
        report_mode,
        intervention,
        macos_key_priming,
        trace,
        show_cursor,
        allow_host_relay_only_stop,
        settings,
    } = params;
    SessionOpenRequest {
        report_mode: report_mode.unwrap_or(ReportMode::Null),
        intervention,
        key_priming: macos_key_priming.map(read_key_priming),
        trace: trace.map(read_trace),
        show_cursor,
        allow_host_relay_only_stop,
        config: settings.map(read_settings),
    }
}
