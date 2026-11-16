//! AX actions and the value ladder (RED stub).

use omo_computer_core::ax::AxHandle;
use omo_computer_core::backend::{BackendResult, Delivered, Refusal, Semantic};
use omo_computer_core::error::{EngineCode, Reason};

use super::reader::MacAx;
use super::seam::AxServer;

fn unsupported() -> Refusal {
    Refusal::new(EngineCode::AxUnsupported, Reason::PerformUnsupported)
}

impl<S: AxServer> MacAx<S> {
    /// # Errors
    /// Always (stub).
    pub fn perform(&mut self, handle: AxHandle, action: &Semantic) -> BackendResult<Delivered> {
        let _ = (handle, action);
        Err(unsupported())
    }

    /// # Errors
    /// Always (stub).
    pub fn set_value(&mut self, handle: AxHandle, text: &str) -> BackendResult<Delivered> {
        let _ = (handle, text);
        Err(unsupported())
    }

    /// # Errors
    /// Always (stub).
    pub fn select_text(
        &mut self,
        handle: AxHandle,
        location: u32,
        length: u32,
    ) -> BackendResult<Delivered> {
        let _ = (handle, location, length);
        Err(unsupported())
    }
}
