//! Row 21a (D10, LEAD: A): a background route names its window, and the fake delivers only to a
//! window it lists and that has not exited; anything else is refused with nothing sent (IS-2).

use omo_computer_core::backend::{Backend, CaptureOptions, InputEvent, Route, Target, TaggedInput};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

use crate::{fixtures_dir, FakeBackend, FakeScenario};

fn load(name: &str) -> FakeBackend {
    FakeBackend::new(FakeScenario::load(&fixtures_dir().join(name)).expect("fixture"))
}

fn click() -> TaggedInput {
    TaggedInput { event: InputEvent::PointerMove(Point { x: 10.0, y: 10.0 }), tag: 7 }
}

fn background(window: &str) -> Route {
    Route::BackgroundWindow { window: window.to_owned() }
}

#[test]
fn ta1_a_background_input_reaches_the_window_it_names() {
    let mut fake = load("two-displays-one-window.json");
    fake.post_input(&click(), background("101")).expect("101 is listed");
    assert_eq!(fake.last_input_window().as_deref(), Some("101"));
    assert_eq!(fake.sink().len(), 1, "one event went out");
}

#[test]
fn ta3_a_background_input_to_an_unlisted_window_is_refused_with_nothing_sent() {
    let mut fake = load("two-displays-one-window.json");
    let refused = fake.post_input(&click(), background("999")).expect_err("not listed");
    assert_eq!(
        (refused.code, refused.reason),
        (EngineCode::BackgroundUnavailable, Some(Reason::TargetUnknown))
    );
    assert!(fake.sink().is_empty(), "nothing sent");
    assert_eq!(fake.last_input_window(), None);
}

#[test]
fn ta3b_a_background_input_to_an_exited_window_is_refused_with_nothing_sent() {
    let mut fake = load("v3-target-exit.json");
    let _ = fake.capture(&Target::Window("101".to_owned()), &CaptureOptions { cursor: true, crosshair: None, region: None });
    assert!(fake.exited("101"), "the script exits 101 on its first capture");
    let refused = fake.post_input(&click(), background("101")).expect_err("exited");
    assert_eq!(
        (refused.code, refused.reason),
        (EngineCode::BackgroundUnavailable, Some(Reason::TargetUnknown))
    );
    assert!(fake.sink().is_empty(), "nothing sent");
}

#[test]
fn ta4_a_foreground_input_carries_no_window_and_still_goes_out() {
    let mut fake = load("two-displays-one-window.json");
    fake.post_input(&click(), Route::ForegroundHid).expect("foreground");
    assert_eq!(fake.last_input_window(), None);
    assert_eq!(fake.sink().len(), 1);
}
