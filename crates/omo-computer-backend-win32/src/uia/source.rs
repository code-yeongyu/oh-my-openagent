//! The seam between the reader and the one UI Automation client: on Windows the client lives on
//! the dedicated MTA `uia` thread (`IUIAutomation` is not `Send`); tests script it.

use omo_computer_core::ax::Slice;

use super::cache::CacheRequest;
use super::element::{Toast, UiaElement, UiaError};

/// The UI Automation reads the reader, the secure-focus read and the settle source take.
pub trait UiaSource {
    /// The client's monotonic clock in milliseconds.
    fn now_ms(&self) -> u64;
    /// Whether `hwnd`'s process runs above this one's integrity band; `None` when unreadable.
    fn elevated(&mut self, hwnd: isize) -> Option<bool>;
    /// The root element of top-level window `hwnd`.
    ///
    /// # Errors
    /// The window is gone or the client is denied.
    fn root(&mut self, hwnd: isize) -> Result<UiaElement, UiaError>;
    /// The root's `ProviderDescription`, which chooses the batching policy.
    fn provider_description(&mut self, root: &UiaElement) -> String;
    /// Children of `parent` from index `from` on, read with `request`, inside `slice_ms`.
    fn children(
        &mut self,
        parent: &UiaElement,
        request: &CacheRequest,
        from: u32,
        slice_ms: u64,
    ) -> Slice<Vec<UiaElement>>;
    /// A fresh read of `element`; `None` when it is gone.
    fn refresh(&mut self, element: &UiaElement, slice_ms: u64) -> Slice<Option<UiaElement>>;
    /// Every element in top-level window `hwnd` whose `RuntimeId` equals `runtime_id`; 0 searches
    /// the window the element was last seen in, and nothing when that is unknown (never the desktop).
    fn find_runtime_id(&mut self, hwnd: isize, runtime_id: &[i32]) -> Vec<UiaElement>;
    /// The element with keyboard focus (`GetFocusedElement`), if any.
    fn focused(&self) -> Option<UiaElement>;
    /// The toasts the shell draws now; `None` without `ShellExperienceHost.exe`.
    fn toasts(&mut self) -> Option<Vec<Toast>>;
}
