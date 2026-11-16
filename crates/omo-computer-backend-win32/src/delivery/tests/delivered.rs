//! `background-delivered-counts` and `background-chromium-refused` on the scripted seam: an
//! addressed background type reports `delivered{count, of}` equal to the units the receiving window
//! got, or the family refusal with nothing posted; a background click on the Chromium class answers
//! `BackgroundUnavailable{chromium_electron}` with no input.

use omo_computer_core::backend::{Delivered, InputEvent};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{Button, Point};

use crate::barrier::Barrier;
use crate::delivery::integrity::Integrity;
use crate::delivery::post::Deliverer;
use crate::input::{WM_CHAR, WM_KEYDOWN, WM_KEYUP};

use super::kit::{win, ScriptedOs, Win};

const NOTEPAD: isize = 0x100;
const NOTEPAD_EDIT: isize = 0x101;
const WEBVIEW2: isize = 0x200;
const WEBVIEW2_RENDER: isize = 0x201;
const WPF: isize = 0x300;

fn fixtures() -> ScriptedOs {
    ScriptedOs::with(vec![
        (NOTEPAD, Win { focus: Some(NOTEPAD_EDIT), ..win("Notepad") }),
        (NOTEPAD_EDIT, win("RichEditD2DPT")),
        (WEBVIEW2, Win { focus: Some(WEBVIEW2_RENDER), child_at: Some(WEBVIEW2_RENDER), ..win("WindowsForms10.Window.8.app.0.1") }),
        (WEBVIEW2_RENDER, win("Chrome_RenderWidgetHostHWND")),
        (WPF, Win { focus: Some(WPF), ..win("HwndWrapper[App;;1f2e]") }),
    ])
}

fn id(window: isize) -> String {
    window.to_string()
}

#[test]
fn background_delivered_counts() {
    let mut os = fixtures();
    let mut deliverer = Deliverer::default();
    // h, e-acute, one Return press for "\r\n", and a surrogate pair: 5 units, 6 messages.
    let typed = deliverer.deliver(&mut os, &id(NOTEPAD), &InputEvent::Text("h\u{e9}\r\n\u{1F600}".to_owned()));
    assert_eq!(typed, Ok(Delivered { count: 5, of: 5 }));
    assert!(os.posts.iter().all(|(to, _)| *to == NOTEPAD_EDIT), "posted to the focus window, never the frame");
    assert_eq!(os.messages(), [WM_CHAR, WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_CHAR, WM_CHAR]);
    assert_eq!(deliverer.last_barrier(), Some(Barrier::Consumed));
    assert_eq!(os.invalidated, [NOTEPAD_EDIT]);
    for (window, reason) in [(WEBVIEW2, Reason::ChromiumElectron), (WPF, Reason::Toolkit)] {
        let before = os.posts.len();
        let refused = deliverer.deliver(&mut os, &id(window), &InputEvent::Text("hi".to_owned()));
        let refused = refused.expect_err("a family that drops posted text is refused");
        assert_eq!((refused.code, refused.reason), (EngineCode::BackgroundUnavailable, Some(reason)));
        assert_eq!(os.posts.len(), before, "nothing posted");
    }
}

#[test]
fn background_chromium_refused() {
    let mut os = fixtures();
    let mut deliverer = Deliverer::default();
    let at = Point { x: 40.0, y: 50.0 };
    let moved = deliverer.deliver(&mut os, &id(WEBVIEW2), &InputEvent::PointerMove(at));
    let refused = moved.expect_err("the Chromium renderer reads only the system queue");
    assert_eq!((refused.code, refused.reason), (EngineCode::BackgroundUnavailable, Some(Reason::ChromiumElectron)));
    for button in [Button::Left, Button::Right] {
        let pressed = deliverer.deliver(&mut os, &id(WEBVIEW2), &InputEvent::Button { button, down: true });
        assert!(pressed.is_err(), "no press without an admitted position");
    }
    assert!(os.posts.is_empty(), "the observer sees no input");
}

#[test]
fn a_background_route_needs_a_live_window() {
    let mut os = fixtures();
    let mut deliverer = Deliverer::default();
    for window in ["notepad", "0", "0x999", "-"] {
        let refused = deliverer.deliver(&mut os, window, &InputEvent::Text("a".to_owned())).expect_err(window);
        assert_eq!((refused.code, refused.reason), (EngineCode::BackgroundUnavailable, Some(Reason::TargetUnknown)));
    }
    assert_eq!(deliverer.deliver(&mut os, "0x100", &InputEvent::Text("a".to_owned())), Ok(Delivered { count: 1, of: 1 }));
    assert!(os.posts.iter().all(|(to, _)| *to == NOTEPAD_EDIT));
}

#[test]
fn a_target_above_the_engine_is_refused_before_any_post() {
    for integrity in [Integrity::Rids { target: 0x3000, engine: 0x2000 }, Integrity::Unreadable] {
        let mut os = fixtures();
        os.integrity = integrity;
        let refused = Deliverer::default().deliver(&mut os, &id(NOTEPAD), &InputEvent::Text("a".to_owned()));
        assert_eq!(refused.map_err(|r| r.code), Err(EngineCode::PermissionDenied));
        assert!(os.posts.is_empty());
    }
}

#[test]
fn a_post_refused_part_way_reports_the_units_that_went_out() {
    let mut os = fixtures();
    os.deny_after = Some(2);
    let text = InputEvent::Text("abcde".to_owned());
    assert_eq!(Deliverer::default().deliver(&mut os, &id(NOTEPAD), &text), Ok(Delivered { count: 2, of: 5 }));
    let mut denied = fixtures();
    denied.deny_after = Some(0);
    let refused = Deliverer::default().deliver(&mut denied, &id(NOTEPAD), &text);
    assert_eq!(refused.map_err(|r| r.code), Err(EngineCode::PermissionDenied), "UIPI answered the first post");
}
