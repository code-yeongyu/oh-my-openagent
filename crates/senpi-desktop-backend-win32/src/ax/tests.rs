//! Display-free checks of the `AxBackend` surface: no COM, no desktop.

use senpi_desktop_core::ax::{AxBackend, AxHandle};
use senpi_desktop_core::error::ErrorCode;

use super::Win32Ax;

#[test]
fn perform_unknown_action_is_ax_failed_naming_it() {
    let mut ax = Win32Ax::new();
    let error = ax.perform(&AxHandle::Id(1), "nonexistent-action").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(
        error.message.contains("'nonexistent-action'"),
        "{}",
        error.message
    );
}

#[test]
fn foreign_handle_is_ax_failed() {
    let mut ax = Win32Ax::new();
    let error = ax.perform(&AxHandle::Id(1), "press").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("non-UIA handle"), "{}", error.message);
}
