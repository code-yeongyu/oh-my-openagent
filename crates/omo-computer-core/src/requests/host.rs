//! Readers of the host-only and protocol params: control grant, the stop path, cancel and
//! the fake clock.

use crate::params::{
    AdvanceClockParams, CancelParams, ControlGrantParams, RequestId, StopPathResumeParams,
    StopPathStartParams, StopPathStopParams,
};

/// A host or protocol call, as the supervisor, the stop path and the call table consume it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostRequest {
    ControlGrant {
        reason: String,
        confirmation_id: Option<String>,
    },
    StopPathStart {
        chord: Option<String>,
    },
    StopPathStop {
        source: Option<String>,
    },
    StopPathResume {
        token: String,
    },
    Cancel {
        id: RequestId,
    },
    AdvanceClock {
        ms: u64,
    },
}

#[must_use]
pub fn read_control_grant(params: ControlGrantParams) -> HostRequest {
    let ControlGrantParams {
        reason,
        confirmation_id,
    } = params;
    HostRequest::ControlGrant {
        reason,
        confirmation_id,
    }
}

#[must_use]
pub fn read_stop_path_start(params: StopPathStartParams) -> HostRequest {
    let StopPathStartParams { chord } = params;
    HostRequest::StopPathStart { chord }
}

#[must_use]
pub fn read_stop_path_stop(params: StopPathStopParams) -> HostRequest {
    let StopPathStopParams { source } = params;
    HostRequest::StopPathStop { source }
}

#[must_use]
pub fn read_stop_path_resume(params: StopPathResumeParams) -> HostRequest {
    let StopPathResumeParams { token } = params;
    HostRequest::StopPathResume { token }
}

#[must_use]
pub fn read_cancel(params: CancelParams) -> HostRequest {
    let CancelParams { id } = params;
    HostRequest::Cancel { id }
}

#[must_use]
pub fn read_advance_clock(params: AdvanceClockParams) -> HostRequest {
    let AdvanceClockParams { ms } = params;
    HostRequest::AdvanceClock { ms }
}
