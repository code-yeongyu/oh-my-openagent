//! Keys, clicks and the wheel on the posted route: modifier chords refused for every family,
//! Alt riding in the message, a click as move + press + release at the child under the point, and
//! the key window falling back to the sole character-wanting descendant.

use omo_computer_core::backend::{Delivered, InputEvent};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{Button, Point};

use crate::barrier::Barrier;
use crate::delivery::messages::{
    point_lparam, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL,
};
use crate::delivery::post::Deliverer;
use crate::input::WM_SYSKEYDOWN;

use super::kit::{win, ScriptedOs, Win, CLIENT};

const FORM: isize = 0x400;
const BUTTON: isize = 0x401;
const EDIT: isize = 0x402;

pub(super) fn form(focus: Option<isize>, wants_chars: Vec<isize>) -> ScriptedOs {
    ScriptedOs::with(vec![
        (
            FORM,
            Win {
                focus,
                wants_chars,
                child_at: Some(EDIT),
                ..win("WindowsForms10.Window.8.app.0.1")
            },
        ),
        (
            BUTTON,
            Win {
                parent: Some(FORM),
                ..win("WindowsForms10.BUTTON.app.0.1")
            },
        ),
        (
            EDIT,
            Win {
                parent: Some(FORM),
                ..win("WindowsForms10.EDIT.app.0.1")
            },
        ),
    ])
}

fn key(key: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: key.to_owned(),
        down,
    }
}

#[test]
fn a_modifier_chord_is_refused_for_every_family_and_alt_rides_in_the_message() {
    let mut os = form(Some(EDIT), Vec::new());
    let mut deliverer = Deliverer::default();
    for chord in ["ctrl+s", "cmd+l", "shift+tab"] {
        let refused = deliverer
            .deliver(&mut os, "0x400", &key(chord, true))
            .expect_err(chord);
        assert_eq!(
            (refused.code, refused.reason),
            (
                EngineCode::BackgroundUnavailable,
                Some(Reason::PostedModifierChord)
            )
        );
    }
    assert!(os.posts.is_empty());
    assert_eq!(
        deliverer.deliver(&mut os, "0x400", &key("alt+f", true)),
        Ok(Delivered { count: 1, of: 1 })
    );
    let (to, posted) = os.posts[0];
    assert_eq!((to, posted.msg), (EDIT, WM_SYSKEYDOWN));
    assert_ne!(posted.lparam & (1 << 29), 0, "the Alt context bit");
    let before = os.posts.len();
    assert_eq!(
        deliverer.deliver(&mut os, "0x400", &key("a", false)),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(
        os.posts.len(),
        before,
        "a character's release posts nothing"
    );
}

#[test]
fn a_click_is_posted_to_the_child_under_the_point_with_one_barrier() {
    let mut os = form(Some(EDIT), Vec::new());
    let mut deliverer = Deliverer::default();
    let at = Point { x: 140.0, y: 220.0 };
    let pressed = deliverer.deliver(
        &mut os,
        "0x400",
        &InputEvent::Button {
            button: Button::Left,
            down: true,
        },
    );
    assert_eq!(
        pressed.map_err(|r| r.reason),
        Err(Some(Reason::NoRegion)),
        "no press before a position"
    );
    assert_eq!(
        deliverer.deliver(&mut os, "0x400", &InputEvent::PointerMove(at)),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(deliverer.last_barrier(), None);
    for down in [true, false] {
        let click = InputEvent::Button {
            button: Button::Left,
            down,
        };
        assert_eq!(
            deliverer.deliver(&mut os, "0x400", &click),
            Ok(Delivered { count: 1, of: 1 })
        );
    }
    assert_eq!(os.messages(), [WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP]);
    assert!(os
        .posts
        .iter()
        .all(|(to, posted)| *to == EDIT && posted.lparam == point_lparam(CLIENT.x, CLIENT.y)));
    assert_eq!(os.posts[1].1.wparam, 1, "MK_LBUTTON on the press");
    assert_eq!(
        (deliverer.last_barrier(), os.invalidated.len()),
        (Some(Barrier::Consumed), 1),
        "one hop, after the release"
    );
}

#[test]
fn the_wheel_posts_one_notch_per_hundred_at_the_screen_point() {
    let mut os = form(Some(EDIT), Vec::new());
    let mut deliverer = Deliverer::default();
    deliverer
        .deliver(
            &mut os,
            "0x400",
            &InputEvent::PointerMove(Point { x: 140.0, y: 220.0 }),
        )
        .expect("move");
    let scrolled = deliverer.deliver(&mut os, "0x400", &InputEvent::Scroll { dx: 0.0, dy: 250.0 });
    assert_eq!(scrolled, Ok(Delivered { count: 3, of: 3 }));
    let wheels: Vec<_> = os.posts.iter().skip(1).map(|(_, posted)| *posted).collect();
    assert!(wheels
        .iter()
        .all(|posted| posted.msg == WM_MOUSEWHEEL && posted.lparam == point_lparam(140, 220)));
    assert_eq!(
        wheels[0].wparam >> 16,
        usize::from((-120_i16).cast_unsigned()),
        "down is toward the user"
    );
}

#[test]
fn keys_fall_back_to_the_sole_character_wanting_descendant() {
    let mut os = form(None, vec![EDIT]);
    assert_eq!(
        Deliverer::default().deliver(&mut os, "0x400", &InputEvent::Text("x".to_owned())),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(os.posts[0].0, EDIT);
    for candidates in [Vec::new(), vec![EDIT, BUTTON]] {
        let mut os = form(None, candidates);
        let refused =
            Deliverer::default().deliver(&mut os, "0x400", &InputEvent::Text("x".to_owned()));
        assert_eq!(
            refused.map_err(|r| r.reason),
            Err(Some(Reason::NoFocusTarget))
        );
        assert!(os.posts.is_empty());
    }
}
