//! The macOS calls capture makes. [`super::os::Os`] implements them on macOS; tests script
//! fakes, so every rule above the seam runs on every OS.

use omo_computer_core::backend::Refusal;

use super::helper::{HelperFrame, HelperRequest};
use super::types::{AxWindowFacts, CaptureFault, CgWindow, DisplayRecord, RawFrame};

/// The OS side of capture.
pub trait CaptureOs: Send {
    /// `CGWindowListCopyWindowInfo(kCGWindowListOptionAll)`, front to back.
    ///
    /// # Errors
    /// The window server answered no list.
    fn window_list(&mut self) -> Result<Vec<CgWindow>, Refusal>;
    /// The start time of `pid` from `proc_pidinfo(PROC_PIDTBSDINFO)` in microseconds since the
    /// epoch; `None` when the process is gone.
    fn process_start(&mut self, pid: u32) -> Option<u64>;
    /// The bundle id of `pid`'s application; `None` for a bare executable.
    fn bundle_id(&mut self, pid: u32) -> Option<String>;
    /// The pid of the frontmost application (the system-wide `AXFocusedApplication`); `None`
    /// when no application is frontmost or AX cannot read it.
    fn frontmost_pid(&mut self) -> Option<u32>;
    /// The accessibility facts of the window; `None` when AX cannot match it.
    fn ax_window(&mut self, window: &CgWindow) -> Option<AxWindowFacts>;
    /// The Space of the window through the probed SkyLight symbol; `None` when unresolved.
    fn space_of(&mut self, number: u32) -> Option<String>;
    /// `CGGetActiveDisplayList` with each display's bounds and backing size.
    ///
    /// # Errors
    /// The display list cannot be read.
    fn displays(&mut self) -> Result<Vec<DisplayRecord>, Refusal>;
    /// The SkyLight window-capture route when its symbol resolved; `None` otherwise.
    fn skylight(&mut self) -> Option<&mut dyn SkylightCapture>;
    /// The running capture helper, started on first use.
    ///
    /// # Errors
    /// [`CaptureFault::HelperGone`] when it cannot be started.
    fn helper(&mut self) -> Result<&mut dyn CaptureHelper, CaptureFault>;
}

/// The SkyLight hardware window capture, one window's own pixels.
pub trait SkylightCapture: Send {
    /// # Errors
    /// A [`CaptureFault`] when the call yields no image.
    fn capture_window(&mut self, number: u32, cursor: bool) -> Result<RawFrame, CaptureFault>;
}

/// The capture helper's request/reply channel.
pub trait CaptureHelper: Send {
    /// # Errors
    /// A [`CaptureFault`] when the helper answers no frame.
    fn call(&mut self, request: &HelperRequest) -> Result<HelperFrame, CaptureFault>;
}
