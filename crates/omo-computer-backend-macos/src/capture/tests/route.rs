//! The capture route ladder: the helper by default, SkyLight only behind its probe and opt-in.

use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::error::{EngineCode, Reason};

use super::kit::{window, FakeOs, FakeSkylight, OWN_PID};
use crate::capture::helper::{HelperRequest, ShotTarget};
use crate::capture::types::AxWindowFacts;
use crate::capture::{CaptureRouteTaken, Capturer};

const POINTER: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn target() -> Target {
    Target::Window("7".into())
}

#[test]
fn skylight_symbol_missing_falls_back_to_sck() {
    let os = FakeOs::with_windows(vec![window(7, 70)]);
    let mut capturer = Capturer::new(os, OWN_PID).with_skylight_opt_in(true);
    let frame = capturer.capture(&target(), &POINTER).expect("frame");
    assert!(frame.width > 0);
    assert_eq!(capturer.last_route(), Some(CaptureRouteTaken::Helper));
    assert!(
        matches!(
            capturer.os().helper.requests.as_slice(),
            [HelperRequest::Screenshot {
                target: ShotTarget::Window { window: 7 },
                cursor: true,
                ..
            }]
        ),
        "the default frame carries the pointer: {:?}",
        capturer.os().helper.requests
    );
}

#[test]
fn skylight_transparent_frame_falls_back_to_the_helper() {
    let mut os = FakeOs::with_windows(vec![window(7, 70)]);
    os.skylight = Some(FakeSkylight { calls: 0, alpha: 0 });
    let mut capturer = Capturer::new(os, OWN_PID).with_skylight_opt_in(true);
    capturer.capture(&target(), &POINTER).expect("frame");
    assert_eq!(capturer.os().skylight.as_ref().map(|s| s.calls), Some(1));
    assert_eq!(capturer.last_route(), Some(CaptureRouteTaken::Helper));
}

#[test]
fn skylight_route_is_used_only_when_opted_in() {
    let mut os = FakeOs::with_windows(vec![window(7, 70)]);
    os.skylight = Some(FakeSkylight {
        calls: 0,
        alpha: 255,
    });
    let mut capturer = Capturer::new(os, OWN_PID);
    capturer.capture(&target(), &POINTER).expect("frame");
    assert_eq!(
        capturer.os().skylight.as_ref().map(|s| s.calls),
        Some(0),
        "opt-in until row 78's receipt"
    );
    assert_eq!(capturer.last_route(), Some(CaptureRouteTaken::Helper));

    let mut capturer = capturer.with_skylight_opt_in(true);
    capturer.capture(&target(), &POINTER).expect("frame");
    assert_eq!(capturer.last_route(), Some(CaptureRouteTaken::SkyLight));
    assert_eq!(
        capturer.os().helper.requests.len(),
        1,
        "no helper still when SkyLight delivered"
    );
}

#[test]
fn minimized_window_is_capture_unavailable() {
    let mut os = FakeOs::with_windows(vec![window(7, 70)]);
    os.ax.insert(
        7,
        AxWindowFacts {
            minimized: true,
            ..AxWindowFacts::default()
        },
    );
    let mut capturer = Capturer::new(os, OWN_PID);
    assert_eq!(
        capturer.capture(&target(), &POINTER),
        Err(Refusal::new(
            EngineCode::CaptureUnavailable,
            Reason::Minimized
        ))
    );
    assert!(
        capturer.os().helper.requests.is_empty(),
        "nothing is captured, nothing restored"
    );
    assert_eq!(capturer.last_route(), None);
}

#[test]
fn unknown_window_is_window_not_found() {
    let mut capturer = Capturer::new(FakeOs::with_windows(vec![window(7, 70)]), OWN_PID);
    for id in ["8", "not-a-number"] {
        assert_eq!(
            capturer.capture(&Target::Window(id.into()), &POINTER),
            Err(Refusal::bare(EngineCode::WindowNotFound))
        );
    }
    assert!(capturer.os().helper.requests.is_empty());
}
