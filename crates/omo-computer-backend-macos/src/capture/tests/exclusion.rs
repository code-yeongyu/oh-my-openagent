//! Overlay and receipt windows (the engine's own) never reach a model frame; a frame that
//! cannot prove it fails instead of shipping.

use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::error::{EngineCode, Reason};

use super::kit::{rect, window, FakeOs, OWN_PID};
use crate::capture::helper::HelperRequest;
use crate::capture::types::DisplayRecord;
use crate::capture::Capturer;

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn with_overlay() -> FakeOs {
    let mut overlay = window(900, OWN_PID);
    overlay.layer = 25;
    FakeOs::with_windows(vec![overlay, window(7, 70)])
}

fn untrusted() -> Refusal {
    Refusal::new(EngineCode::CaptureFailed, Reason::UntrustedPixels)
}

#[test]
fn display_still_names_the_engines_own_windows_and_ships_when_they_are_excluded() {
    let mut capturer = Capturer::new(with_overlay(), OWN_PID);
    capturer
        .capture(&Target::Display("1".into()), &OPTIONS)
        .expect("frame");
    assert!(matches!(
        capturer.os().helper.requests.as_slice(),
        [HelperRequest::Screenshot { exclude, .. }] if exclude == &vec![900]
    ));
}

#[test]
fn exclusion_unprovable_fails_the_frame() {
    let mut os = with_overlay();
    os.helper.drop_exclusions = true;
    let mut capturer = Capturer::new(os, OWN_PID);
    assert_eq!(
        capturer.capture(&Target::Display("1".into()), &OPTIONS),
        Err(untrusted())
    );
    assert_eq!(
        capturer.capture(&Target::Desktop, &OPTIONS),
        Err(untrusted())
    );
}

#[test]
fn a_stream_frame_never_answers_a_model_still() {
    let mut os = with_overlay();
    os.helper.stills_from_stream = true;
    let mut capturer = Capturer::new(os, OWN_PID);
    assert_eq!(
        capturer.capture(&Target::Window("7".into()), &OPTIONS),
        Err(untrusted())
    );
}

#[test]
fn desktop_composites_every_display_in_its_own_points() {
    let mut os = with_overlay();
    os.displays = vec![
        DisplayRecord {
            id: 1,
            bounds: rect(0.0, 0.0, 8.0, 4.0),
            pixel_width: 16,
            pixel_height: 8,
            main: true,
        },
        DisplayRecord {
            id: 2,
            bounds: rect(8.0, 0.0, 8.0, 4.0),
            pixel_width: 8,
            pixel_height: 4,
            main: false,
        },
    ];
    let mut capturer = Capturer::new(os, OWN_PID);
    let frame = capturer
        .capture(&Target::Desktop, &OPTIONS)
        .expect("desktop");
    assert_eq!(
        (frame.width, frame.height),
        (32, 8),
        "laid out at the largest scale"
    );
    let stills = capturer.os().helper.requests.len();
    assert_eq!(stills, 2, "one excluded still per display");
}

#[test]
fn unknown_display_is_refused_before_any_still() {
    let mut capturer = Capturer::new(with_overlay(), OWN_PID);
    assert!(capturer
        .capture(&Target::Display("9".into()), &OPTIONS)
        .is_err());
    assert!(capturer.os().helper.requests.is_empty());
}
