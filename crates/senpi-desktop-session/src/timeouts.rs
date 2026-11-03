use std::time::Duration;

/// Deadline of one session request, measured from submission (queue wait
/// included).
pub const OPERATION_TIMEOUT: Duration = Duration::from_secs(60);
/// Deadline of `close`: the session thread must release the backend within it.
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// Deadlines injected at construction, so timeout tests never wait real
/// minutes (the engine reads `SENPI_DESKTOP_OPERATION_TIMEOUT_MS` /
/// `SENPI_DESKTOP_CLOSE_TIMEOUT_MS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionTimeouts {
    pub operation: Duration,
    pub close: Duration,
}

impl SessionTimeouts {
    /// A valid hold gets its requested duration plus the ordinary operation
    /// margin for queueing, delivery, and restoration.
    pub(crate) fn budget_for(self, op: &crate::request::Op) -> Duration {
        let seconds = match op {
            crate::request::Op::HoldKeys(params) => params.duration,
            crate::request::Op::HoldMouse(params) => params.duration,
            _ => return self.operation,
        };
        if seconds.is_finite() && (0.0..=100.0).contains(&seconds) {
            self.operation + Duration::from_secs_f64(seconds)
        } else {
            self.operation
        }
    }
}

impl Default for SessionTimeouts {
    fn default() -> Self {
        Self {
            operation: OPERATION_TIMEOUT,
            close: CLOSE_TIMEOUT,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::request::Op;
    use senpi_desktop_core::protocol_params::{HoldKeysParams, HoldMouseParams};

    #[test]
    fn holds_get_their_duration_plus_the_injected_operation_margin() {
        let timeouts = SessionTimeouts { operation: Duration::from_secs(3), close: CLOSE_TIMEOUT };
        for seconds in [0.0, 61.0, 100.0] {
            let keys = Op::HoldKeys(HoldKeysParams {
                target: "101".into(), keys: vec!["shift".into()], duration: seconds, opts: None,
            });
            let mouse = Op::HoldMouse(HoldMouseParams {
                target: "101".into(), x: 0.0, y: 0.0, duration: seconds,
                button: None, keys: None, frame_id: None, opts: None,
            });
            let expected = Duration::from_secs_f64(seconds) + timeouts.operation;
            assert_eq!(timeouts.budget_for(&keys), expected);
            assert_eq!(timeouts.budget_for(&mouse), expected);
        }
        assert_eq!(timeouts.budget_for(&Op::Displays), timeouts.operation);
    }
}
