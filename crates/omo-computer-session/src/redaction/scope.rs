//! The read-tier reach of the denied-app table and `app_scope` (d-safety.md 'Per-app scope',
//! FOLD-13 k-safety row 3): a read that targets a window of an app consent refuses is refused as
//! its exec would be, before anything is read, so no tree, diff, frame or focused element leaves.
//! A desktop or display target names no window and is not app-scoped.

use omo_computer_core::backend::Refusal;

use crate::apps::{denied, window_app};
use crate::Session;

/// # Errors
/// `ControlRequired{denied_app | app_scope | user_stopped | identity_changed}` for a window of
/// an app consent refuses.
pub(crate) fn admit_window_read(session: &mut Session, target: &str) -> Result<(), Refusal> {
    let app = window_app(session, target);
    session.funnel.control.consent.admit_read(app.as_ref()).map(|_| ()).map_err(|denial| denied(denial).refusal)
}
