use std::collections::BTreeSet;

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::params::Button;

use super::{Holds, Note};
use crate::input::fake::{FakeServer, NoteLog, Request};
use crate::input::keys::{keysym, GroupMap};
use crate::input::server::FakeInput;
use crate::input::{InputSettings, X11Input};

#[test]
fn every_note_reads_back_from_its_line() {
    let notes = [
        Note::Key(38),
        Note::Unkey(38),
        Note::Button(1, (-5, 700)),
        Note::Unbutton(1),
        Note::Remap(200, vec![0, 0x0100_ac00]),
        Note::Restored(200),
    ];
    for note in notes {
        assert_eq!(Note::parse(&note.to_string()), Some(note.clone()), "{note}");
    }
    assert_eq!(
        Note::parse("key 300"),
        None,
        "a keycode outside u8 is no note"
    );
    assert_eq!(Note::parse("press 9"), None);
}

#[test]
fn a_dead_engines_holds_are_released_buttons_at_their_origin_first() {
    let mut holds = Holds::default();
    for note in [
        Note::Key(9),
        Note::Button(1, (5, 6)),
        Note::Remap(11, vec![0, 0]),
        Note::Key(10),
        Note::Unkey(10),
    ] {
        holds.apply(note);
    }
    let server = FakeServer::default();
    holds.release(&server);
    assert_eq!(
        server.log(),
        [
            Request::Fake(FakeInput::Motion { x: 5, y: 6 }),
            Request::Fake(FakeInput::Button {
                detail: 1,
                press: false
            }),
            Request::Fake(FakeInput::Key {
                code: 9,
                press: false
            }),
            Request::Remap {
                code: 11,
                keysyms: vec![0, 0]
            },
        ]
    );
}

#[test]
fn every_hold_is_noted_before_it_is_pressed_and_user_held_keys_never() {
    let x = keysym("x").expect("keysym");
    let server = FakeServer::with(
        GroupMap::new(
            9,
            vec![vec![[x, 0]], vec![[keysym("a").expect("a"), 0]]],
            &BTreeSet::new(),
        ),
        0,
    );
    server.state().down.insert(10);
    let mut input = X11Input::new(server.clone(), InputSettings::default())
        .with_witness(Box::new(NoteLog(server.clone())));
    let key = |name: &str| InputEvent::Key {
        key: name.to_owned(),
        down: true,
    };
    input.post(&key("x"), Route::ForegroundHid).expect("x");
    input
        .post(&key("a"), Route::ForegroundHid)
        .expect("a, held by the user");
    input
        .post(
            &InputEvent::Button {
                button: Button::Left,
                down: true,
            },
            Route::ForegroundHid,
        )
        .expect("button");
    drop(input);
    let note = |line: &str| Request::Note(line.to_owned());
    assert_eq!(
        server.log(),
        [
            note("key 9"),
            Request::Fake(FakeInput::Key {
                code: 9,
                press: true
            }),
            Request::Fake(FakeInput::Key {
                code: 10,
                press: true
            }),
            note("button 1 0 0"),
            Request::Fake(FakeInput::Button {
                detail: 1,
                press: true
            }),
            Request::Fake(FakeInput::Motion { x: 0, y: 0 }),
            Request::Fake(FakeInput::Button {
                detail: 1,
                press: false
            }),
            note("unbutton 1"),
            Request::Fake(FakeInput::Key {
                code: 9,
                press: false
            }),
            note("unkey 9"),
        ]
    );
}
