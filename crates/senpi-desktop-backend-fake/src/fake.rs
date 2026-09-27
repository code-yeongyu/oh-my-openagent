//! `FakeBackend` state and the gates every scripted call passes through.

use image::Rgba;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::types::{DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, Target};

use crate::ax_tree::AxTree;
use crate::faults::Faults;
use crate::method::FakeMethod;
use crate::scenario::{DelayMs, FakeScenario, ResizeWindow};
use crate::sink::{RecordingSink, SinkOp};

/// Scripted headless `Backend` + `AxBackend`: serves a [`FakeScenario`],
/// records every side effect into a [`RecordingSink`], and fails calls queued
/// through [`Faults`]. Never touches an OS API.
///
/// Delivery model: `foreground` input into a window focuses that window, and
/// desktop-target or `foreground` pointer input moves the cursor; `background`
/// window input changes neither, like a real background-delivery backend.
pub struct FakeBackend {
    pub(crate) displays: Vec<DesktopDisplay>,
    pub(crate) windows: Vec<DesktopWindow>,
    pub(crate) capabilities: DesktopCapabilities,
    pub(crate) cursor: Option<DesktopPoint>,
    pub(crate) capture_color: Rgba<u8>,
    delays: DelayMs,
    pub(crate) resize_window: Option<ResizeWindow>,
    pub(crate) ax_tree: AxTree,
    pub(crate) sink: RecordingSink,
    faults: Faults,
}

impl FakeBackend {
    pub fn new(scenario: FakeScenario) -> Self {
        let faults = Faults::default();
        for failure in &scenario.fail_next {
            faults.fail_next(failure.method, failure.code);
        }
        Self {
            ax_tree: AxTree::build(&scenario.ax),
            displays: scenario.displays,
            windows: scenario.windows,
            capabilities: scenario.capabilities,
            cursor: scenario.cursor,
            capture_color: Rgba(scenario.capture_color),
            delays: scenario.delay_ms,
            resize_window: scenario.resize_window,
            sink: RecordingSink::default(),
            faults,
        }
    }

    /// A handle on the op log that stays valid after the backend is boxed.
    pub fn sink(&self) -> RecordingSink {
        self.sink.clone()
    }

    /// A handle on the failure queues that stays valid after the backend is boxed.
    pub fn faults(&self) -> Faults {
        self.faults.clone()
    }

    /// Makes the next call of `method` fail with `code`.
    pub fn fail_next(&self, method: FakeMethod, code: ErrorCode) {
        self.faults.fail_next(method, code);
    }

    /// Entry of every fallible call: scripted delay, then a queued failure.
    pub(crate) fn begin(&self, method: FakeMethod) -> CoreResult<()> {
        if let Some(delay) = self.delays.for_method(method) {
            std::thread::sleep(delay);
        }
        self.faults.take(method).map_or(Ok(()), Err)
    }

    pub(crate) fn window(&self, id: &str) -> CoreResult<&DesktopWindow> {
        self.windows
            .iter()
            .find(|window| window.id == id)
            .ok_or_else(|| DesktopError::window_not_found(format!("window {id} is not in the fake scenario")))
    }

    /// Refuses input the scenario's capabilities say this host cannot deliver.
    pub(crate) fn input_gate(&self, target: &Target, mode: DeliveryMode) -> CoreResult<()> {
        if !self.capabilities.input {
            return Err(DesktopError::input_failed(
                "input is unavailable in this fake scenario",
            ));
        }
        let mode_name = match mode {
            DeliveryMode::Background => "background",
            DeliveryMode::Foreground => "foreground",
        };
        if !self
            .capabilities
            .delivery_modes
            .iter()
            .any(|known| known == mode_name)
        {
            return Err(DesktopError::input_failed(format!(
                "delivery mode '{mode_name}' is not supported by this backend"
            )));
        }
        match target {
            Target::Desktop => Ok(()),
            Target::Window(id) => {
                self.window(id)?;
                if mode == DeliveryMode::Background && !self.capabilities.background_window_input {
                    return Err(DesktopError::background_unavailable(format!(
                        "window {id}: background window input is unavailable on this host"
                    )));
                }
                Ok(())
            }
        }
    }

    /// Applies the focus side effect of input delivered to `target`.
    pub(crate) fn deliver_focus(&mut self, target: &Target, mode: DeliveryMode) {
        if let (Target::Window(id), DeliveryMode::Foreground) = (target, mode) {
            self.focus_window(id);
        }
    }

    pub(crate) fn focus_window(&mut self, id: &str) {
        for window in &mut self.windows {
            window.focused = window.id == id;
        }
    }

    pub(crate) fn record(&self, op: SinkOp) {
        self.sink.record(op);
    }
}
