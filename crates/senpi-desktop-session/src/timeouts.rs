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

impl Default for SessionTimeouts {
    fn default() -> Self {
        Self {
            operation: OPERATION_TIMEOUT,
            close: CLOSE_TIMEOUT,
        }
    }
}
