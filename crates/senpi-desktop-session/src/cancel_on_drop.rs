use std::sync::Arc;

use senpi_desktop_safety::HoldSignal;

/// Retained across the async reply wait, so abandoning that future wakes
/// an active hold even though its reply receiver disappears separately.
pub(crate) struct CancelOnDrop(pub(crate) Arc<HoldSignal>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
