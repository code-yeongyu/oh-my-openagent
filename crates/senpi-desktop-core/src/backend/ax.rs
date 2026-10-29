use crate::ax::{AxHandle, AxProps};
use crate::error::{CoreResult, DesktopError};
use crate::protocol_results::AxTextSelection;
use crate::text_range::TextSelectRequest;
use crate::types::DesktopWindow;

/// The native window that owns an accessibility element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AxOwner {
    /// The owner's id, in the form [`super::Backend::windows`] lists it.
    Window(String),
    /// The backend cannot name the owner; callers must not guess it.
    Unknown,
}

pub trait AxBackend {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle>;
    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps>;
    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>>;
    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>>;
    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()>;
    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()>;
    fn focus(&mut self, h: &AxHandle) -> CoreResult<()>;
    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>>;
    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>>;
    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>>;

    fn owner(&mut self, _h: &AxHandle, _windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        Ok(AxOwner::Unknown)
    }

    fn select_text(
        &mut self,
        _h: &AxHandle,
        _request: &TextSelectRequest,
    ) -> CoreResult<AxTextSelection> {
        Err(DesktopError::ax_unsupported())
    }
}
