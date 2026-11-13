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
    Refusal::new(EngineCode::Internal, Reason::NoDisplayServer.wire())
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
        Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported.wire()))
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
        let compositor = self.capture.as_ref().map(|c| c.server().compositor_present().unwrap_or(false));
        Some(self.live.diagnose(self.capture.is_some(), compositor))
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::observation::CursorMode;

    use super::*;
    use crate::capture::fake::{FakeX, GREEN};
    use crate::capture::server::PixelRect;

    fn options() -> CaptureOptions {
        CaptureOptions {
            cursor: true,
            crosshair: None,
            region: None,
        }
    }

    #[test]
    fn no_display_refuses_capture_and_displays_with_nothing_sent() {
        let mut backend = X11Backend::from_env(None, None);
        assert_eq!(backend.display_server(), "none");
        let ruled = Refusal::new(EngineCode::Internal, "no_display_server");
        assert_eq!(backend.capture(&Target::Desktop, &options()).unwrap_err(), ruled);
        assert_eq!(backend.displays().unwrap_err(), ruled);
        assert_eq!(backend.windows(&WindowFilter::default()).unwrap_err(), ruled);
        let input = TaggedInput {
            event: omo_computer_core::backend::InputEvent::Text("x".into()),
            tag: 1,
        };
        assert_eq!(backend.post_input(&input, Route::ForegroundHid).unwrap_err(), ruled);
        let mut empty = X11Backend::from_env(Some(""), None);
        assert_eq!(empty.display_server(), "none");
        assert_eq!(empty.capture(&Target::Desktop, &options()).unwrap_err(), ruled);
    }

    #[test]
    fn capabilities_report_the_display_server_state() {
        let none = X11Backend::from_env(None, None).capabilities();
        assert_eq!(none.backend, "x11");
        assert!(!none.capture.available);
        assert_eq!(none.capture.reason.as_deref(), Some("no_display_server"));
        let mut server = FakeX::two_screens();
        server.composite_extension = false;
        let live = X11Backend::with_capture(Some(X11Capture::new(server, None))).capabilities();
        assert!(live.capture.available && live.window_capture.available);
        assert_eq!(live.capture.route, Some(CaptureRoute::RootCrop));
        assert_eq!(live.display_count, 2);
    }

    #[test]
    fn capture_returns_png_with_its_annotations() {
        let server = FakeX::single(160, 120).with_window(
            9,
            PixelRect {
                x: 10,
                y: 10,
                width: 50,
                height: 40,
            },
            GREEN,
        );
        let mut backend = X11Backend::with_capture(Some(X11Capture::new(server, None)));
        let frame = backend.capture(&Target::Window("9".into()), &options()).expect("frame");
        assert_eq!((frame.width, frame.height), (50, 40));
        assert_eq!(frame.mime, ImageMime::Png);
        assert!(frame.bytes.starts_with(b"\x89PNG"));
        assert_eq!(frame.route, Some(CaptureRoute::Composite));
        assert_eq!(frame.occluders_visible, Some(false));
        assert_eq!(frame.cursor, Some(CursorMode::None));
    }
}
