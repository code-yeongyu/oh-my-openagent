//! What a settle reads: the backend's monotonic clock and its settle source.

use omo_computer_core::backend::{
    AxEvent, Backend, BackendResult, NotificationFingerprint, SettleSource,
};
use omo_computer_core::observation::BusyIndicator;

/// The reads one settle takes. The engine's feed is its backend; a test feed may step a wall
/// clock beside the monotonic one to prove that a wait reads only the monotonic one.
pub trait Feed {
    /// The backend's monotonic clock in milliseconds.
    fn now_ms(&self) -> u64;

    /// The next observer event, or `None` at `until_ms`.
    ///
    /// # Errors
    /// The backend has no observer.
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>>;

    /// The loading indicator `window` shows now.
    ///
    /// # Errors
    /// The indicator cannot be read.
    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>>;
}

/// The engine's feed: the session's backend, its clock and its settle source.
pub(crate) struct BackendFeed<'a> {
    backend: &'a mut dyn Backend,
    source: Box<dyn SettleSource>,
}

/// The feed of `backend`; `None` when it has no clock or no settle source.
pub(crate) fn feed(backend: &mut dyn Backend) -> Option<BackendFeed<'_>> {
    backend.clock()?;
    let source = backend.settle_source()?;
    Some(BackendFeed { backend, source })
}

impl BackendFeed<'_> {
    /// The backend, for the reads a `waitFor` predicate matches an event against.
    pub(crate) fn backend(&mut self) -> &mut dyn Backend {
        &mut *self.backend
    }

    /// # Errors
    /// The backend has no notification surface.
    pub(crate) fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        self.source.notifications()
    }
}

impl Feed for BackendFeed<'_> {
    fn now_ms(&self) -> u64 {
        self.backend.clock().map_or(0, |clock| clock.now_ms())
    }

    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        self.source.wait_event(until_ms)
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        self.source.busy(window)
    }
}
