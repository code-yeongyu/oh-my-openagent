//! `Win32Backend::post_input` delivers through row 21a's addressed background route; the
//! foreground route (row 57's lease) and a pid-only address keep refusing with nothing sent.

use omo_computer_core::backend::{Backend, Delivered, InputEvent, Route, TaggedInput};
use omo_computer_core::error::{EngineCode, Reason};

use crate::backend::Win32Backend;
use crate::barrier::Barrier;
use crate::capture::{CaptureFault, CaptureOs, RawFrame, SessionCondition, WindowFacts};
use crate::displays::Monitor;
use crate::ocr::OcrProbe;

use super::kit::{win, ScriptedOs, Win};

struct NoCapture;

impl CaptureOs for NoCapture {
    fn session_id(&self) -> u32 {
        1
    }
    fn wgc_supported(&mut self) -> bool {
        false
    }
    fn session(&mut self) -> SessionCondition {
        SessionCondition::UNKNOWN
    }
    fn monitors(&mut self) -> Result<Vec<Monitor>, omo_computer_core::backend::Refusal> {
        Ok(Vec::new())
    }
    fn window(&mut self, _hwnd: isize) -> Option<WindowFacts> {
        None
    }
    fn wgc_window(&mut self, _hwnd: isize, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        Err(CaptureFault::NullFrame)
    }
    fn wgc_monitor(&mut self, _monitor: &Monitor, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        Err(CaptureFault::NullFrame)
    }
    fn print_window(&mut self, _hwnd: isize, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        Err(CaptureFault::NullFrame)
    }
    fn bitblt_monitor(&mut self, _monitor: &Monitor, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        Err(CaptureFault::NullFrame)
    }
    fn ocr_probe(&mut self) -> OcrProbe {
        OcrProbe::unavailable("no_language_pack")
    }
    fn recognize(&mut self, _frame: &RawFrame) -> Option<Vec<omo_computer_core::observation::OcrLine>> {
        None
    }
}

fn typed(text: &str) -> TaggedInput {
    TaggedInput { event: InputEvent::Text(text.to_owned()), tag: 7 }
}

#[test]
fn post_input_delivers_to_the_window_the_route_names() {
    let os = ScriptedOs::with(vec![(0x100, Win { focus: Some(0x101), ..win("Notepad") }), (0x101, win("Edit"))]);
    let mut backend = Win32Backend::with_os(NoCapture).with_delivery(Box::new(os));
    let route = Route::BackgroundWindow { window: "256".to_owned() };
    assert_eq!(backend.post_input(&typed("ok"), route), Ok(Delivered { count: 2, of: 2 }));
    assert_eq!(backend.last_barrier(), Some(Barrier::Consumed));
    let pid = backend.post_input(&typed("x"), Route::BackgroundPid { pid: 4 });
    assert_eq!(pid.map_err(|r| r.reason), Err(Some(Reason::TargetUnknown)));
    let foreground = backend.post_input(&typed("x"), Route::ForegroundHid);
    assert_eq!(foreground.map_err(|r| (r.code, r.reason)), Err((EngineCode::Internal, Some(Reason::InputUnsupported))));
}
