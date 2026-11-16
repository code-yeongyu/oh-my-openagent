//! What stands at a mapped point before input is sent, and the reason token
//! a coordinate refusal carries in an object-mode reply.

use crate::error::{DesktopError, ErrorReport};

/// The accessibility element under a global logical point, as a backend
/// read it. `secure` marks a secure text field: the session never reports
/// its label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PointHit {
    pub role: String,
    pub label: Option<String>,
    pub secure: bool,
}

/// Attaches the object-mode `data.reason` token to a coordinate refusal; a
/// `reportMode: "null"` session drops it before the reply.
#[must_use]
pub fn frame_reason(error: DesktopError, reason: &str) -> DesktopError {
    error.with_report(ErrorReport {
        reason: Some(reason.to_owned()),
        ..ErrorReport::default()
    })
}
