//! Row 49's route proofs against the recording fake: the frame verbs' requests and read-back,
//! the send-on-enter guard, and the background route's toolkit admission.

use std::collections::BTreeMap;

use omo_computer_core::backend::{Delivered, InputEvent, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::settings::SendOnEnterRule;
use omo_computer_core::window_frame::{judge, Axis, FrameOutcome};

use super::fake::Request;
use super::server::WmRequest;
use super::wiring_tests::{input, text, FOCUS};
use super::InputSettings;
use crate::toolkit::Evidence;

#[test]
fn frame_verb_reads_back_from_configure_notify() {
    let (mut x11, server) = input(InputSettings::default());
    let asked = Rect {
        x: 10.0,
        y: 20.0,
        width: 640.0,
        height: 480.0,
    };
    let tiled = Rect {
        x: 10.0,
        y: 20.0,
        width: 960.0,
        height: 1080.0,
    };
    server.state().configured = Some(tiled);
    let applied = x11.set_frame("9", asked).expect("read back");
    assert_eq!(applied.frame, tiled);
    assert_eq!(
        judge(asked, applied.frame),
        FrameOutcome::Partial {
            kept: vec![Axis::Width, Axis::Height]
        }
    );
    assert_eq!(server.log(), [Request::Wm(9, WmRequest::MoveResize(asked))]);
    x11.set_minimized("9", true)
        .expect_err("no frame scripted: the window is gone");
    server.state().frame = Some(asked);
    x11.set_minimized("9", false).expect("restored");
    assert_eq!(
        server.log()[1..],
        [
            Request::Wm(9, WmRequest::Iconify),
            Request::Wm(9, WmRequest::Activate)
        ]
    );
}

#[test]
fn send_on_enter_refuses_return_into_a_listed_composer_with_nothing_sent() {
    let send_on_enter =
        BTreeMap::from([("Slack".to_owned(), SendOnEnterRule { chords: Vec::new() })]);
    let (mut x11, server) = input(InputSettings {
        send_on_enter,
        ..InputSettings::default()
    });
    server.state().evidence.insert(
        FOCUS,
        Evidence {
            wm_class: "Slack".into(),
            ..Evidence::default()
        },
    );
    let refused = Refusal::new(EngineCode::ConsequentialAction, Reason::SendOnEnter);
    assert_eq!(
        x11.post(&text("hi\n"), Route::ForegroundHid),
        Err(refused.clone()),
        "an unknown role fails closed"
    );
    let enter = |down| InputEvent::Key {
        key: "enter".to_owned(),
        down,
    };
    assert_eq!(x11.post(&enter(true), Route::ForegroundHid), Err(refused));
    assert_eq!(server.log(), []);
    let shift = InputEvent::Key {
        key: "shift".to_owned(),
        down: true,
    };
    x11.post(&shift, Route::ForegroundHid).expect("shift");
    x11.post(&enter(true), Route::ForegroundHid)
        .expect("shift+return is not the sending chord");
    let mut button_role = x11.with_focused_role(Box::new(|| Some("push button".to_owned())));
    button_role
        .post(&text("\n"), Route::ForegroundHid)
        .expect("a button is no composer");
}

#[test]
fn background_input_goes_by_xsendevent_only_to_a_client_that_takes_it() {
    let (mut x11, server) = input(InputSettings::default());
    server.state().evidence.insert(
        FOCUS,
        Evidence {
            maps: vec!["libXt.so.6".into()],
            ..Evidence::default()
        },
    );
    assert_eq!(
        x11.post(&text("x"), Route::BackgroundWindow),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(server.fakes(), [], "never XTEST on the background route");
    assert_eq!(
        server.log().len(),
        2,
        "press and release sent to the window"
    );
    server.state().evidence.clear();
    let unknown = x11
        .post(&text("x"), Route::BackgroundWindow)
        .expect_err("unknown client");
    assert_eq!(unknown.wire_data()["toolkit"], "unknown");
    assert_eq!(server.log().len(), 2, "nothing sent on the refusal");
}
