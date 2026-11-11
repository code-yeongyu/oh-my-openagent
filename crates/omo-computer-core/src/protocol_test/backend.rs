//! Every default of `Backend` / `AxBackend` refuses with nothing sent: a backend that
//! overrides nothing can neither read nor drive the desktop.

use crate::backend::{
    AxBackend, Backend, CaptureOptions, InputEvent, PermissionProbe, Ref, Refusal, Route, Semantic,
    SnapshotRequest, TaggedInput, Target, WindowFilter, PRESENCE_UNAVAILABLE,
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
    assert_eq!((refusal.code, refusal.reason), (code, reason));
    assert_eq!(
        refusal.computer_code().map(ComputerCode::wire),
        Ok(computer)
    );
    assert!(refusal.nothing_sent(), "{reason}: a refusal sends nothing");
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
