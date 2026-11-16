//! The macOS implementation of [`CaptureOs`].

mod ax;
pub(crate) mod cf;
mod helper_process;
pub(crate) mod listing;
pub(crate) mod process;
mod skylight;
pub(crate) mod symbols;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

pub use helper_process::{HELPER_ENV, HELPER_NAME};

use crate::capture::seam::{CaptureHelper, CaptureOs, SkylightCapture};
use crate::capture::types::{AxWindowFacts, CaptureFault, CgWindow, DisplayRecord};

/// The live macOS capture seam.
#[derive(Default)]
pub struct Os {
    skylight: Option<skylight::Skylight>,
    helper: helper_process::HelperProcess,
}

impl Os {
    /// Probes the SkyLight capture symbols once, at session open.
    #[must_use]
    pub fn open() -> Self {
        Self {
            skylight: skylight::Skylight::probe(),
            helper: helper_process::HelperProcess::default(),
        }
    }
}

impl CaptureOs for Os {
    fn window_list(&mut self) -> Result<Vec<CgWindow>, Refusal> {
        listing::windows().ok_or(Refusal::new(
            EngineCode::Internal,
            Reason::WindowsUnsupported,
        ))
    }

    fn process_start(&mut self, pid: u32) -> Option<u64> {
        process::start(pid)
    }

    fn bundle_id(&mut self, pid: u32) -> Option<String> {
        process::bundle_id(pid)
    }

    fn ax_window(&mut self, window: &CgWindow) -> Option<AxWindowFacts> {
        ax::facts(window)
    }

    /// The Space read belongs to row 45 (`spaces.rs`); until then every window reads `None`.
    fn space_of(&mut self, _number: u32) -> Option<String> {
        None
    }

    fn displays(&mut self) -> Result<Vec<DisplayRecord>, Refusal> {
        listing::displays().ok_or(Refusal::new(
            EngineCode::Internal,
            Reason::DisplaysUnsupported,
        ))
    }

    fn skylight(&mut self) -> Option<&mut dyn SkylightCapture> {
        self.skylight
            .as_mut()
            .map(|s| s as &mut dyn SkylightCapture)
    }

    fn helper(&mut self) -> Result<&mut dyn CaptureHelper, CaptureFault> {
        self.helper.pipe()
    }
}
