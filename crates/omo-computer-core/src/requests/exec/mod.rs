//! Readers of the exec verbs' params: each turns its params into the one `ExecRequest`
//! the `mutate()` funnel consumes - the verb, where it aims, the send policy (`delivery`,
//! `force`), the call-bound authority and the `observeAfter` observation.

mod keys;
mod pointer;
mod targets;

pub use keys::{
    read_clipboard_write, read_key_down, read_key_up, read_paste, read_press, read_type,
};
pub use pointer::{read_click, read_drag, read_mouse_down, read_mouse_up, read_move, read_scroll};
pub use targets::{
    read_apps_open, read_apps_quit, read_menu_select, read_select_text, read_set_value,
    read_window, read_window_frame,
};

use super::options::{read_observe_options, At, ObserveSpec, TextSpan};
use crate::params::{Button, Delivery, ObserveOptions, PasteFormat, ScrollDirection};

/// The authority a call is bound to: the call id and the run generation it was issued in.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CallAuthority {
    pub call_id: Option<String>,
    pub run_generation: Option<u64>,
}

/// How an exec verb may be sent: the route the model asked for and whether the user's own
/// message authorised a consequential or dangerous send (`force`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SendPolicy {
    pub delivery: Option<Delivery>,
    pub force: bool,
}

/// The window verbs that take only a target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowVerb {
    Raise,
    Activate,
    Minimize,
    Restore,
}

/// What an exec verb does, with its verb-specific data.
#[derive(Debug, Clone, PartialEq)]
pub enum Verb {
    Click {
        at: Option<At>,
        button: Option<Button>,
        count: Option<u8>,
        modifiers: Vec<String>,
        consume: bool,
    },
    Move {
        at: At,
    },
    MouseDown {
        button: Option<Button>,
        at: Option<At>,
    },
    MouseUp {
        button: Option<Button>,
    },
    KeyDown {
        chord: String,
    },
    KeyUp {
        chord: String,
    },
    Drag {
        from: At,
        to: At,
        button: Option<Button>,
        modifiers: Vec<String>,
        path: Vec<At>,
    },
    Type {
        text: String,
    },
    Press {
        chord: String,
        repeat: Option<u32>,
    },
    Paste {
        text: String,
        format: Option<PasteFormat>,
    },
    Scroll {
        at: At,
        dx: Option<f64>,
        dy: Option<f64>,
        clicks: Option<u32>,
        direction: Option<ScrollDirection>,
    },
    SetValue {
        value: String,
    },
    SelectText {
        span: TextSpan,
    },
    MenuSelect {
        path: Vec<String>,
    },
    AppsOpen {
        activate: Option<bool>,
        reveal: Option<bool>,
        observe: Option<ObserveSpec>,
    },
    AppsQuit,
    Window(WindowVerb),
    SetFrame {
        x: Option<f64>,
        y: Option<f64>,
        width: Option<f64>,
        height: Option<f64>,
    },
    ClipboardWrite {
        text: String,
        format: Option<PasteFormat>,
    },
}

/// The one shape every exec verb reaches `mutate()` in.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecRequest {
    pub verb: Verb,
    pub target: Option<String>,
    pub reference: Option<String>,
    pub frame_id: Option<String>,
    pub policy: SendPolicy,
    pub authority: CallAuthority,
    pub observe_after: Option<ObserveSpec>,
}

/// Where a verb aims and how it may be sent, before the authority is attached.
pub(super) struct Common {
    pub(super) target: Option<String>,
    pub(super) reference: Option<String>,
    pub(super) frame_id: Option<String>,
    pub(super) policy: SendPolicy,
}

pub(super) fn request(
    verb: Verb,
    common: Common,
    call_id: Option<String>,
    run_generation: Option<u64>,
    observe_after: Option<ObserveOptions>,
) -> ExecRequest {
    let Common {
        target,
        reference,
        frame_id,
        policy,
    } = common;
    let authority = CallAuthority {
        call_id,
        run_generation,
    };
    ExecRequest {
        verb,
        target,
        reference,
        frame_id,
        policy,
        authority,
        observe_after: observe_after.map(read_observe_options),
    }
}

pub(super) fn aimed(target: Option<String>) -> Common {
    Common {
        target,
        reference: None,
        frame_id: None,
        policy: SendPolicy::default(),
    }
}

pub(super) fn at(x: Option<f64>, y: Option<f64>) -> Option<At> {
    x.zip(y).map(|(x, y)| At { x, y })
}
