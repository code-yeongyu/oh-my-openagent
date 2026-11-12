//! Building the fake from the seams, per-persona identity, frames, and the panic fault.

use omo_computer_core::backend::{
    Backend, CaptureOptions, InputEvent, Route, TaggedInput, Target, WindowFilter,
};
use omo_computer_core::params::Button;

use omo_computer_core::error::{EngineCode, Reason, UnknownFailure};

use crate::{
    fixtures_dir, FakeBackend, FakeClock, FakeMethod, FakeScenario, Fault, Persona, RecordingSink,
    SeamError, StopPathScript,
};

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn click() -> TaggedInput {
    TaggedInput {
        event: InputEvent::Button {
            button: Button::Left,
            down: true,
        },
        tag: 1,
    }
}

#[test]
fn personas_seams_and_frames() {
    let scenario =
        FakeScenario::load(&fixtures_dir().join("two-displays-one-window.json")).expect("loads");
    for persona in Persona::ALL {
        let mut fake = FakeBackend::new(scenario.clone()).with_persona(persona);
        let listing = fake.windows(&WindowFilter::default()).expect("listed");
        let identity = &listing.windows[0].identity;
        let handles = [
            identity.window_number.is_some(),
            identity.xid.is_some(),
            identity.hwnd.is_some(),
        ];
        let expected = match persona {
            Persona::Macos => [true, false, false],
            Persona::X11 => [false, true, false],
            Persona::Wayland => [false, false, false],
            Persona::Win32 => [false, false, true],
        };
        assert_eq!(handles, expected, "{persona:?}");
    }
    let mut fake = FakeBackend::new(scenario);
    let frame = fake
        .capture(&Target::Display("2".to_owned()), &OPTIONS)
        .expect("a frame");
    assert_eq!(
        (frame.width, frame.height),
        (2880, 1800),
        "logical size times the display scale"
    );
    assert_eq!(&frame.bytes[1..4], b"PNG");

    let seams = |pairs: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    };
    let built = FakeBackend::from_seams(
        seams(&[
            ("OMO_COMPUTER_FAKE_CLOCK", "250"),
            ("OMO_COMPUTER_FAKE_STOP_PATH", "live"),
        ]),
        RecordingSink::default(),
    );
    let mut live = built.expect("valid seams");
    assert_eq!(live.clock().now_ms(), 250);
    let mut listener = live.stop_listener().expect("a live listener");
    assert_eq!(listener.poll_stop(), Ok(false));
    live.press_stop_chord();
    assert_eq!(
        (listener.poll_stop(), listener.poll_stop()),
        (Ok(true), Ok(false))
    );
    let deaf = FakeBackend::new(FakeScenario::default()).with_stop_path(StopPathScript::Deaf);
    assert!(deaf.capabilities().stop_path.deaf);
    assert!(
        FakeBackend::new(FakeScenario::default())
            .stop_listener()
            .is_err(),
        "no listener by default"
    );
    assert!(matches!(
        FakeBackend::from_seams(
            seams(&[("OMO_COMPUTER_FAKE_STOP_PATH", "loud")]),
            RecordingSink::default()
        ),
        Err(SeamError::StopPath { .. })
    ));
    assert!(matches!(
        FakeBackend::from_seams(
            seams(&[("OMO_COMPUTER_FAKE_SCENARIO", "/nonexistent.json")]),
            RecordingSink::default()
        ),
        Err(SeamError::Scenario(_))
    ));
    assert!(FakeClock::from_seam(Some("-1")).is_err());
}

#[test]
fn a_panic_fault_panics_and_the_backend_survives() {
    let mut fake = FakeBackend::from_json("{}").expect("empty");
    fake.inject(FakeMethod::Displays, Fault::Panic)
        .expect("a panic fault needs no row");
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fake.displays()));
    assert!(caught.is_err(), "the scripted panic unwinds");
    assert_eq!(
        fake.displays(),
        Ok(Vec::new()),
        "the state survives the poisoned lock"
    );
    fake.inject(FakeMethod::Click, Fault::RefuseFocus)
        .expect("a focus refusal needs no row");
    assert_eq!(
        fake.post_input(&click(), Route::ForegroundHid)
            .map_err(|r| (r.code, r.reason)),
        Err((EngineCode::InputFailed, Some("activation_refused")))
    );
    assert!(fake.sink().is_empty());
}

#[test]
fn inject_refuses_a_fail_pair_the_table_has_no_row_for() {
    let mut fake = FakeBackend::from_json("{}").expect("empty");
    let off_table = Fault::Fail {
        code: EngineCode::Closed,
        reason: Some(Reason::Minimized),
    };
    assert!(
        matches!(
            fake.inject(FakeMethod::Displays, off_table),
            Err(UnknownFailure::Pair(_))
        ),
        "inject refuses the pair the loader refuses"
    );
    assert_eq!(
        fake.displays().map_err(|r| (r.code, r.reason)),
        Ok(Vec::new()),
        "an off-table pair is never queued"
    );
}
