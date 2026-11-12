//! The posted route's target: the focused child of the target window's GUI thread
//! (`GetGUIThreadInfo().hwndFocus`), never the top-level frame - a WM_CHAR posted to the frame is
//! dropped (SP-N #13145@e0e08a126e:n-barrier-posted-proves-notepad posted to the focus window, dst
//! Edit). No focus refuses BackgroundUnavailable{no_focus_target} (design-reasons.tsv:53,
//! design/d-sdk-skill.md:499) and nothing is posted.

use omo_computer_core::error::{EngineCode, Reason};

use crate::input::focus_child::{focus_child, FocusOs};

struct Scripted {
    thread: Option<u32>,
    focus: Option<isize>,
}

impl FocusOs for Scripted {
    fn window_thread(&self, _window: isize) -> Option<u32> {
        self.thread
    }
    fn thread_focus(&self, _thread: u32) -> Option<isize> {
        self.focus
    }
}

const FRAME: isize = 0x1000;
const EDIT: isize = 0x1004;

#[test]
fn posted_target_is_the_focused_child_never_the_frame() {
    assert_eq!(
        focus_child(
            &Scripted {
                thread: Some(7),
                focus: Some(EDIT)
            },
            FRAME
        ),
        Ok(EDIT)
    );
    for os in [
        Scripted {
            thread: Some(7),
            focus: None,
        },
        Scripted {
            thread: None,
            focus: Some(EDIT),
        },
    ] {
        let refusal = focus_child(&os, FRAME).expect_err("no focus target");
        assert_eq!(refusal.code, EngineCode::BackgroundUnavailable);
        assert_eq!(refusal.reason, Some(Reason::NoFocusTarget.wire()));
    }
}
