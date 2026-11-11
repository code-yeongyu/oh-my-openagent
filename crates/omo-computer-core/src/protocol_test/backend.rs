//! Every default of `Backend` / `AxBackend` refuses: a backend that overrides nothing can
//! neither read nor drive the desktop, and no default reaches the send path.

use crate::backend::{
    AxBackend, Backend, BackendResult, CaptureOptions, Delivered, InputEvent, PermissionProbe, Ref,
    Refusal, Route, Semantic, SnapshotRequest, TaggedInput, Target, WindowFilter,
    PRESENCE_UNAVAILABLE,
};
use crate::error::{ComputerCode, EngineCode};
use crate::params::{ObserveOptions, Point};
use crate::results::PermissionState;

struct Bare;

impl Backend for Bare {}
impl AxBackend for Bare {}

fn assert_refused<T: std::fmt::Debug>(
    result: Result<T, Refusal>,
    code: EngineCode,
    computer: &str,
    reason: &str,
) {
    let refusal = result.expect_err("a default must refuse");
    assert_eq!((refusal.code, refusal.reason), (code, Some(reason)));
    assert_eq!(
        refusal.computer_code().map(ComputerCode::wire),
        Ok(computer)
    );
}

#[test]
fn backend_defaults_refuse() {
    let mut bare = Bare;
    let target = Target::Window("101".to_owned());
    let input = TaggedInput {
        event: InputEvent::PointerMove(Point { x: 1.0, y: 2.0 }),
        tag: 7,
    };
    let capture = CaptureOptions {
        cursor: true,
        crosshair: None,
        region: None,
    };
    assert_refused(
        bare.windows(&WindowFilter::default()),
        EngineCode::Internal,
        "COMPUTER_UNAVAILABLE",
        "windows_unsupported",
    );
    assert_refused(
        bare.displays(),
        EngineCode::Internal,
        "COMPUTER_UNAVAILABLE",
        "displays_unsupported",
    );
    assert_refused(
        bare.capture(&target, &capture),
        EngineCode::CaptureUnavailable,
        "COMPUTER_CAPTURE_UNAVAILABLE",
        "capture_unsupported",
    );
    assert_refused(
        bare.post_input(&input, Route::BackgroundPid),
        EngineCode::Internal,
        "COMPUTER_UNAVAILABLE",
        "input_unsupported",
    );
    assert_refused(
        bare.stop_listener().map(drop),
        EngineCode::StopPathUnavailable,
        "COMPUTER_SUPERVISOR_NOT_LIVE",
        "no_listener",
    );
    assert_refused(
        bare.epoch_source().next_change(),
        EngineCode::Internal,
        "COMPUTER_UNAVAILABLE",
        "epoch_source_unsupported",
    );
    assert!(bare.presence().is_none(), "no presence surface by default");
    assert_eq!(
        PRESENCE_UNAVAILABLE.computer_code().map(ComputerCode::wire),
        Ok("COMPUTER_PRESENCE_UNAVAILABLE")
    );
    let unknown = PermissionState::Unknown;
    assert_eq!(
        bare.probe_permissions(),
        PermissionProbe {
            capture: unknown,
            input: unknown,
            accessibility: unknown
        }
    );
    let capabilities = bare.capabilities();
    assert!(
        !capabilities.capture.available
            && !capabilities.window_capture.available
            && !capabilities.window_input.available
    );
    assert!(
        !capabilities.observe
            && !capabilities.background_window_input
            && capabilities.input_modes.is_empty()
    );
    assert!(capabilities.delivery_modes.is_empty() && capabilities.surfaces.is_empty());
}

#[test]
fn ax_backend_defaults_refuse() {
    let mut bare = Bare;
    let reference = Ref("s1:e2".to_owned());
    let request = SnapshotRequest {
        target: Target::Desktop,
        options: ObserveOptions::default(),
    };
    assert_refused(
        bare.snapshot(&request),
        EngineCode::AxUnsupported,
        "COMPUTER_AX_UNAVAILABLE",
        "snapshot_unsupported",
    );
    assert_refused(
        bare.resolve(&reference),
        EngineCode::AxUnsupported,
        "COMPUTER_AX_UNAVAILABLE",
        "resolve_unsupported",
    );
    assert_refused(
        bare.perform(&reference, &Semantic("press".to_owned())),
        EngineCode::AxUnsupported,
        "COMPUTER_AX_UNAVAILABLE",
        "perform_unsupported",
    );
    assert_refused(
        bare.events().next_event(),
        EngineCode::AxUnsupported,
        "COMPUTER_AX_UNAVAILABLE",
        "ax_events_unsupported",
    );
}

/// A backend whose only overrides are the two send paths, each recording what it was asked
/// to send. Every other method is the default.
#[derive(Default)]
struct Recorder {
    sent: Vec<String>,
}

impl Backend for Recorder {
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.sent
            .push(format!("post_input {:?} via {route:?}", input.event));
        Ok(Delivered { count: 1, of: 1 })
    }
}

impl AxBackend for Recorder {
    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        self.sent
            .push(format!("perform {} on {}", action.0, reference.0));
        Ok(Delivered { count: 1, of: 1 })
    }
}

#[test]
fn no_default_reaches_the_send_path() {
    let mut recorder = Recorder::default();
    let target = Target::Desktop;
    let capture = CaptureOptions {
        cursor: true,
        crosshair: None,
        region: None,
    };
    let reference = Ref("s1:e2".to_owned());
    let request = SnapshotRequest {
        target: Target::Desktop,
        options: ObserveOptions::default(),
    };
    let _ = recorder.capabilities();
    let _ = recorder.probe_permissions();
    assert!(recorder.windows(&WindowFilter::default()).is_err());
    assert!(recorder.displays().is_err());
    assert!(recorder.capture(&target, &capture).is_err());
    assert!(recorder.stop_listener().is_err());
    assert!(recorder.epoch_source().next_change().is_err());
    assert!(recorder.presence().is_none());
    assert!(recorder.snapshot(&request).is_err());
    assert!(recorder.resolve(&reference).is_err());
    assert!(recorder.events().next_event().is_err());
    assert!(
        recorder.sent.is_empty(),
        "a default reached the send path: {:?}",
        recorder.sent
    );
    let input = TaggedInput {
        event: InputEvent::Text("a".to_owned()),
        tag: 1,
    };
    assert!(recorder.post_input(&input, Route::Ax).is_ok());
    assert!(recorder
        .perform(&reference, &Semantic("press".to_owned()))
        .is_ok());
    assert_eq!(
        recorder.sent.len(),
        2,
        "the recorder hears both send paths: {:?}",
        recorder.sent
    );
}
