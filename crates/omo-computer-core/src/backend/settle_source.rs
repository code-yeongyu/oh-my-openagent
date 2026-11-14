//! The reads the settle primitive and `waitFor` take: the observer events with a deadline on
//! the backend's clock, the loading indicator of a target window, and the notification
//! surface. A backend without them answers `None` from `Backend::settle_source`, which every
//! settle reads as `unsupported`.

use super::refusal::{BackendResult, Refusal};
use super::types::AxEvent;
use crate::error::{EngineCode, Reason};
use crate::observation::BusyIndicator;

/// `Unavailable{surface:"notification", reason:"no_notification_surface"}`: the OS exposes no
/// notification surface, so a `waitFor({notification})` answers with nothing waited.
pub const NO_NOTIFICATION_SURFACE: Refusal =
    Refusal::new(EngineCode::Internal, Reason::NoNotificationSurface.wire());

/// One notification as the surface lists it; the body is kept only as its hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationFingerprint {
    pub app: String,
    pub title: String,
    pub body_hash: String,
    /// When it arrived, on the backend's clock.
    pub arrived_at_ms: u64,
}

/// The settle reads of one backend.
pub trait SettleSource: Send {
    /// The next observer event, waited for until `until_ms` on the backend's monotonic clock
    /// and never past it; `None` at the deadline.
    ///
    /// # Errors
    /// The backend's observer is gone.
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>>;

    /// The loading indicator `window` shows now; `None` when it shows none.
    ///
    /// # Errors
    /// The window cannot be read.
    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>>;

    /// The notifications the surface lists now.
    ///
    /// # Errors
    /// [`NO_NOTIFICATION_SURFACE`] by default.
    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        Err(NO_NOTIFICATION_SURFACE)
    }
}
