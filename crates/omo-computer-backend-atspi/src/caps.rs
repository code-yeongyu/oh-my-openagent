//! The accessibility tri-state and the `ax` capability the vector reports.

use serde::Serialize;

/// `ax_permission`: read on every `capabilities()`, never asserted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AxPermission {
    BusUnreachable,
    ToolkitsSilent,
    Granted,
}

/// `ax:{available, reason?}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AxCapability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}
