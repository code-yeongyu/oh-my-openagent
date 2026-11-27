//! Row 49's wiring proofs against the recording fake: the request sequences XTEST, the hold
//! ledger, the scratch remap and the press origin put on the wire.

use std::collections::BTreeSet;
use std::panic::{catch_unwind, AssertUnwindSafe};

use omo_computer_core::backend::{Delivered, InputEvent, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{Button, Point};

use super::fake::{FakeServer, Request};
use super::keys::{keysym, GroupMap};
use super::server::FakeInput;
use super::tests::GA;
use super::{InputSettings, X11Input};
use crate::toolkit::Evidence;

pub(super) const FOCUS: u32 = 5;

fn ks(grapheme: &str) -> u32 {
    keysym(grapheme).expect("keysym")
}

/// `a` 8, `x` 9, Return 10, free 11, Shift_L 12.
fn keyboard() -> GroupMap {
    let rows = vec![
        vec![[ks("a"), ks("A")]],
        vec![[ks("x"), ks("X")]],
        vec![[ks("\n"), 0]],
        vec![[0, 0]],
        vec![[0xffe1, 0]],
    ];
    GroupMap::new(8, rows, &BTreeSet::new())
}

pub(super) fn input(settings: InputSettings) -> (X11Input<FakeServer>, FakeServer) {
    let server = FakeServer::with(keyboard(), 0);
    server.state().focus = FOCUS;
    (X11Input::new(server.clone(), settings), server)
}

fn key(code: u8, press: bool) -> FakeInput {
    FakeInput::Key { code, press }
}

pub(super) fn text(value: &str) -> InputEvent {
    InputEvent::Text(value.to_owned())
}

#[test]
fn xtest_requires_foreground_lease() {
    let (mut x11, server) = input(InputSettings::default());
    let gtk = Evidence {
        wm_class: "Gedit".into(),
        maps: vec!["libgtk-3.so.0".into()],
        ..Evidence::default()
    };
    server.state().evidence.insert(FOCUS, gtk);
    let refusal = x11
        .post(&text("x"), Route::BackgroundWindow)
        .expect_err("no lease route, no XTEST");
    assert_eq!(refusal.code, EngineCode::BackgroundUnavailable);
    assert_eq!(
        server.log(),
        [],
        "zero XTEST requests and nothing sent without the lease"
    );
    assert_eq!(
        x11.post(&text("x"), Route::ForegroundHid),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(server.fakes(), [key(9, true), key(9, false)]);
}

#[test]
fn user_held_key_is_not_released() {
    let (mut x11, server) = input(InputSettings::default());
    server.state().down.insert(8);
    assert_eq!(x11.user_held_keys(), ["a"]);
    let down = |key: &str, down: bool| InputEvent::Key {
        key: key.to_owned(),
        down,
    };
    x11.post(&down("a", true), Route::ForegroundHid)
        .expect("press");
    x11.post(&down("x", true), Route::ForegroundHid)
        .expect("press");
    assert_eq!(
        x11.post(&down("a", false), Route::ForegroundHid),
        Ok(Delivered { count: 0, of: 1 })
    );
    drop(x11);
    assert_eq!(
        server.fakes(),
        [key(8, true), key(9, true), key(9, false)],
        "only the engine's own key is released"
    );
}

#[test]
fn a_remap_followed_by_an_injected_error_still_restores_the_mapping() {
    let settings = InputSettings {
        keymap_remap: true,
        ..InputSettings::default()
    };
    let (mut x11, server) = input(settings);
    server.state().fail_fake_from = Some(1);
    let refusal = x11
        .post(&text(&format!("{GA}x")), Route::ForegroundHid)
        .expect_err("the release failed");
    assert_eq!(refusal, Refusal::bare(EngineCode::InputFailed));
    assert_eq!(
        server.log(),
        [
            Request::Remap {
                code: 11,
                keysyms: vec![0, 0]
            },
            Request::Remap {
                code: 11,
                keysyms: vec![ks(GA), ks(GA)]
            },
            Request::Fake(key(11, true)),
            Request::Fake(key(11, false)),
            Request::Remap {
                code: 11,
                keysyms: vec![0, 0]
            },
        ],
        "the scratch key is released and its keysyms restored on the error path"
    );
}

#[test]
fn a_panic_mid_stroke_releases_the_stroke_and_restores_the_scratch() {
    let settings = InputSettings {
        keymap_remap: true,
        ..InputSettings::default()
    };
    let (mut x11, server) = input(settings);
    server.state().panic_at_fake = Some(1);
    let unwound = catch_unwind(AssertUnwindSafe(|| {
        x11.post(&text(GA), Route::ForegroundHid)
    }));
    assert!(unwound.is_err(), "the injected panic unwinds");
    assert_eq!(server.fakes(), [key(11, true), key(11, false)]);
    assert_eq!(
        server.log().last(),
        Some(&Request::Remap {
            code: 11,
            keysyms: vec![0, 0]
        })
    );
}

#[test]
fn a_server_that_refuses_the_remap_answers_unresolvable_with_nothing_sent() {
    let settings = InputSettings {
        keymap_remap: true,
        ..InputSettings::default()
    };
    let (mut x11, server) = input(settings);
    server.state().refuse_remap = true;
    let refusal = x11
        .post(&text(&format!("x{GA}")), Route::ForegroundHid)
        .expect_err("refused");
    assert_eq!(refusal.reason, Some(Reason::Unresolvable));
    assert_eq!(server.fakes(), [], "the `x` before it was not typed");
}

#[test]
fn pointer_posts_nothing() {
    let (x11, server) = input(InputSettings::default());
    server.state().pointer = (40, 30);
    assert_eq!(x11.pointer(), Some(Point { x: 40.0, y: 30.0 }));
    assert_eq!(server.log(), []);
}

#[test]
fn every_button_release_warps_to_the_press_origin_first() {
    let (mut x11, server) = input(InputSettings::default());
    server.state().pointer = (5, 6);
    let left = |down| InputEvent::Button {
        button: Button::Left,
        down,
    };
    x11.post(&left(true), Route::ForegroundHid).expect("down");
    x11.post(
        &InputEvent::PointerMove(Point { x: 50.0, y: 60.0 }),
        Route::ForegroundHid,
    )
    .expect("drag");
    x11.post(&left(false), Route::ForegroundHid).expect("up");
    x11.post(&left(true), Route::ForegroundHid)
        .expect("down again");
    drop(x11);
    let button = |press| FakeInput::Button { detail: 1, press };
    let at = |x, y| FakeInput::Motion { x, y };
    assert_eq!(
        server.fakes(),
        [
            button(true),
            at(50, 60),
            at(5, 6),
            button(false),
            button(true),
            at(5, 6),
            button(false)
        ],
        "the up and the drop's release helper both warp to the origin"
    );
}
