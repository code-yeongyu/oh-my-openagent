//! The X11 `Backend`. Without a reachable display every capture verb answers
//! `CaptureUnavailable` with nothing sent; the backend never connects to a display other
//! than the one `DISPLAY` names.

use omo_computer_core::backend::{
    refusing_capabilities, Backend, BackendResult, CaptureOptions, FrameBytes, Refusal, Target,
    WindowFilter, WindowList,
};
use omo_computer_core::capabilities::{Availability, Capabilities, CaptureCapability, CaptureRoute};
use omo_computer_core::backend::{Delivered, Route, TaggedInput};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::observation::ImageMime;
use omo_computer_core::results::DisplayInfo;

use crate::capture::server::XServer;
use crate::capture::{failed, list_windows, png, process_facts, X11Capture, X11Connection};

/// The `OMO_COMPUTER_BACKEND` value that selects this backend.
pub const X11_BACKEND: &str = "x11";

fn no_display() -> Refusal {
    Refusal::new(EngineCode::Internal, Reason::NoDisplayServer)
}

pub struct X11Backend<S = X11Connection> {
    capture: Option<X11Capture<S>>,
    live: crate::stop_path::Live,
}

impl X11Backend<X11Connection> {
    /// Connects to `display` when it is set; an unset or unreachable display leaves a backend
    /// whose capture verbs refuse.
    #[must_use]
    pub fn from_env(display: Option<&str>, gdk_scale: Option<&str>) -> Self {
        let display = display.filter(|value| !value.is_empty());
        let live = crate::stop_path::Live::for_display(display);
        let capture = display.and_then(|display| match X11Connection::connect(display) {
            Ok(connection) => Some(X11Capture::new(connection, gdk_scale.map(str::to_owned))),
            Err(error) => {
                eprintln!("omo-computer-backend-x11: display {display} unreachable: {error}");
                None
            }
        });
        Self { capture, live }
    }
}

impl<S: XServer> X11Backend<S> {
    #[must_use]
    pub fn with_capture(capture: Option<X11Capture<S>>) -> Self {
        Self {
            capture,
            live: crate::stop_path::Live::for_display(None),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_live(capture: Option<X11Capture<S>>, live: crate::stop_path::Live) -> Self {
        Self { capture, live }
    }

    /// `none` when no display is reachable, else `x11`.
    #[must_use]
    pub const fn display_server(&self) -> &'static str {
        if self.capture.is_some() {
            "x11"
        } else {
            "none"
        }
    }
}

impl<S: XServer> Backend for X11Backend<S> {
    fn capabilities(&self) -> Capabilities {
        let mut capabilities = refusing_capabilities();
        capabilities.backend = X11_BACKEND.to_owned();
        capabilities.stop_path.deaf_reason = self.live.deaf_reason();
        let Some(capture) = &self.capture else {
            capabilities.capture.reason = Some(Reason::NoDisplayServer.wire().to_owned());
            capabilities.window_capture.reason = Some(Reason::NoDisplayServer.wire().to_owned());
            return capabilities;
        };
        let route = if capture.server().composite_available() {
            CaptureRoute::Composite
        } else {
            CaptureRoute::RootCrop
        };
        capabilities.display_count = capture
            .displays()
            .map_or(0, |displays| u32::try_from(displays.len()).unwrap_or(u32::MAX));
        capabilities.capture = CaptureCapability {
            available: true,
            reason: None,
            route: Some(route),
        };
        capabilities.window_capture = Availability {
            available: true,
            reason: None,
        };
        capabilities
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        let capture = self.capture.as_ref().ok_or_else(no_display)?;
        let clients = capture.server().client_windows().map_err(|error| failed(&error))?;
        Ok(list_windows(&clients, &capture.readings()?, filter, &process_facts))
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.capture.as_ref().ok_or_else(no_display)?.displays()
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        let _ = (input, route);
        self.capture.as_ref().ok_or_else(no_display)?;
        Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported))
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        let capture = self.capture.as_ref().ok_or_else(no_display)?;
        let frame = self.live.overlay.hidden_for(|| capture.capture_frame(target, options))?;
        let bytes = png(&frame.image).map_err(|error| failed(&error))?;
        Ok(FrameBytes {
            width: frame.image.width(),
            height: frame.image.height(),
            mime: ImageMime::Png,
            bytes,
            route: Some(frame.route),
            occluders_visible: Some(frame.occluders_visible),
            cursor: Some(frame.cursor),
        })
    }

    // --- Row 50: stop path, presence, epoch source, self set and doctor (stop_path::Live). ---

    fn stop_listener(&mut self) -> BackendResult<Box<dyn omo_computer_core::backend::StopListener>> {
        self.live.stop_listener()
    }

    fn set_stop_chord(&mut self, chord: Option<&str>) -> BackendResult<()> {
        self.live.set_chord(chord)
    }

    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        Some(omo_computer_core::report::Platform::X11)
    }

    fn presence(&mut self) -> Option<Box<dyn omo_computer_core::backend::Presence>> {
        self.live.presence()
    }

    fn epoch_source(&mut self) -> Box<dyn omo_computer_core::backend::EpochSource> {
        self.live.epoch_source()
    }

    fn processes(&self) -> Option<omo_computer_core::backend::ProcessTable> {
        Some(self.live.processes())
    }

    fn take_lease_end(&mut self) -> bool {
        self.live.lease_end.take()
    }

    fn diagnose(&self) -> Option<omo_computer_core::backend::BackendProbes> {
        let compositor = match self.capture.as_ref().map(|c| c.server().compositor_present()) {
            None => crate::diagnose::CompositorRead::NoDisplay,
            Some(Ok(present)) => crate::diagnose::CompositorRead::Present(present),
            Some(Err(_)) => crate::diagnose::CompositorRead::Failed,
        };
        Some(self.live.diagnose(self.capture.is_some(), compositor))
    }
}

#[cfg(test)]
#[path = "backend_tests.rs"]
mod tests;
