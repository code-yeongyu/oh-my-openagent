//! Input lands only in the addressed window (IS-1): the GUI thread's focus window counts only when
//! it is the addressed window or one of its descendants. A focus in another top-level window of the
//! same thread (a dialog, a second frame) is never posted to: the key window falls back to the
//! addressed window's sole character-wanting descendant, else the verb is refused with nothing sent.

use omo_computer_core::backend::{Delivered, InputEvent};
use omo_computer_core::error::{EngineCode, Reason};

use crate::delivery::post::Deliverer;

use super::kit::{win, ScriptedOs, Win};

const MAIN: isize = 0x500;
const MAIN_EDIT: isize = 0x501;
const DIALOG: isize = 0x510;
const DIALOG_EDIT: isize = 0x511;

/// A main window and a dialog on ONE GUI thread (the main window's), the focus in the dialog.
fn shared_thread(main_wants_chars: Vec<isize>) -> ScriptedOs {
    let thread = u32::try_from(MAIN).ok();
    ScriptedOs::with(vec![
        (
            MAIN,
            Win {
                focus: Some(DIALOG_EDIT),
                wants_chars: main_wants_chars,
                ..win("WindowsForms10.Window.8.app.0.1")
            },
        ),
        (
            MAIN_EDIT,
            Win {
                parent: Some(MAIN),
                thread,
                ..win("WindowsForms10.EDIT.app.0.1")
            },
        ),
        (
            DIALOG,
            Win {
                thread,
                ..win("#32770")
            },
        ),
        (
            DIALOG_EDIT,
            Win {
                parent: Some(DIALOG),
                thread,
                ..win("Edit")
            },
        ),
    ])
}

fn events() -> [InputEvent; 2] {
    [
        InputEvent::Text("\r\n".to_owned()),
        InputEvent::Key {
            key: "return".to_owned(),
            down: true,
        },
    ]
}

#[test]
fn a_focus_in_another_top_level_window_of_the_thread_is_never_posted_to() {
    for event in events() {
        let mut os = shared_thread(Vec::new());
        let refused = Deliverer::default().deliver(&mut os, "0x500", &event);
        assert_eq!(
            refused.map_err(|r| (r.code, r.reason)),
            Err((
                EngineCode::BackgroundUnavailable,
                Some(Reason::NoFocusTarget)
            )),
            "{event:?}"
        );
        assert!(
            os.posts.is_empty(),
            "nothing reaches the dialog nobody addressed: {:?}",
            os.posts
        );
    }
}

#[test]
fn a_foreign_focus_falls_back_to_the_addressed_windows_sole_character_wanting_descendant() {
    for event in events() {
        let mut os = shared_thread(vec![MAIN_EDIT]);
        assert_eq!(
            Deliverer::default().deliver(&mut os, "0x500", &event),
            Ok(Delivered { count: 1, of: 1 }),
            "{event:?}"
        );
        assert!(os.posts.iter().all(|(to, _)| *to == MAIN_EDIT));
    }
}

#[test]
fn the_dialog_itself_takes_input_when_it_is_the_addressed_window() {
    let mut os = shared_thread(Vec::new());
    assert_eq!(
        Deliverer::default().deliver(&mut os, "0x510", &InputEvent::Text("y".to_owned())),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(os.posts[0].0, DIALOG_EDIT);
}
