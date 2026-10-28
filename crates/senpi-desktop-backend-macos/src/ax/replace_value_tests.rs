//! The order of a whole-value replacement's focus and foreground checks
//! (oh-my-pi 0838d2ab44 `replace_whole_value` tests) over a scripted field.
//! oh-my-pi's cancellation case becomes a press check refusing during the
//! selection write: our cancellation is checked by the session around the
//! request, and the press check is the in-call seam.

use std::cell::{Cell, RefCell};

use objc2_application_services::AXError;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::intervention::{check_press, watch};

use super::replace_value::{may_borrow_focus, replace_whole_value, TextField};

#[test]
fn focus_is_borrowed_only_from_a_known_background_app() {
    assert!(may_borrow_focus(Some(10), 20));
    assert!(!may_borrow_focus(Some(20), 20));
    assert!(!may_borrow_focus(None, 20));
}

/// A background field whose user, while the selection probes block, brings
/// its app forward and, with `takes_focus`, clicks another control in it.
struct ScriptedField {
    focused: Cell<bool>,
    switches: bool,
    switches_on_select: bool,
    takes_focus: bool,
    switched: Cell<bool>,
    /// What the focus and selection setters answer after applying.
    focus_reply: AXError,
    select_reply: AXError,
    calls: RefCell<Vec<&'static str>>,
    /// What the insertion answers.
    insert_reply: Option<ErrorCode>,
    /// The user types into the field's app while the selection write blocks:
    /// the press check installed for the request refuses from then on.
    types_on_select: Cell<bool>,
}

thread_local! {
    static USER_TYPED: Cell<bool> = const { Cell::new(false) };
}

fn press_check() -> CoreResult<()> {
    if USER_TYPED.with(Cell::get) {
        Err(DesktopError::user_intervened("the user typed in the app"))
    } else {
        Ok(())
    }
}

impl ScriptedField {
    fn new(switches: bool, takes_focus: bool) -> Self {
        Self {
            focused: Cell::new(false),
            switches,
            switches_on_select: false,
            takes_focus,
            switched: Cell::new(false),
            focus_reply: AXError::Success,
            select_reply: AXError::Success,
            calls: RefCell::default(),
            insert_reply: None,
            types_on_select: Cell::new(false),
        }
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.borrow().clone()
    }
}

impl TextField for ScriptedField {
    type Element = ();

    fn focused(&self) -> Option<bool> {
        Some(self.focused.get())
    }

    fn focus_owner(&self) -> Option<()> {
        Some(())
    }

    fn in_background(&self) -> bool {
        !self.switched.get()
    }

    fn brought_forward(&self) -> bool {
        self.switched.get()
    }

    fn focus(&self) -> AXError {
        self.calls.borrow_mut().push("focus");
        self.focused.set(true);
        self.focus_reply
    }

    fn hand_focus_to(&self, (): &()) -> AXError {
        self.calls.borrow_mut().push("hand back");
        self.focused.set(false);
        AXError::Success
    }

    fn selectable_length(&self) -> Option<isize> {
        if self.switches {
            self.switched.set(true);
            if self.takes_focus {
                self.focused.set(false);
            }
        }
        Some(3)
    }

    fn select(&self, _: isize) -> AXError {
        self.calls.borrow_mut().push("select");
        if self.switches_on_select {
            self.switched.set(true);
        }
        if self.types_on_select.get() {
            USER_TYPED.with(|typed| typed.set(true));
        }
        self.select_reply
    }

    fn insert(&self, _: &str) -> CoreResult<()> {
        self.calls.borrow_mut().push("insert");
        match self.insert_reply {
            None => Ok(()),
            Some(code) => Err(DesktopError::new(code, "injected insertion refusal")),
        }
    }
}

#[test]
fn a_background_field_is_focused_selected_and_replaced() {
    let field = ScriptedField::new(false, false);
    assert!(replace_whole_value(&field, "abc").unwrap());
    assert_eq!(field.calls(), ["focus", "select", "insert"]);
}

#[test]
fn a_focused_field_whose_app_comes_forward_during_the_probes_is_not_typed_over() {
    let field = ScriptedField {
        focused: Cell::new(true),
        ..ScriptedField::new(true, false)
    };
    assert!(!replace_whole_value(&field, "abc").unwrap());
    assert!(field.calls().is_empty(), "{:?}", field.calls());
}

#[test]
fn bringing_the_app_forward_during_the_probes_leaves_its_selection_alone() {
    let field = ScriptedField::new(true, false);
    assert!(!replace_whole_value(&field, "abc").unwrap());
    assert_eq!(field.calls(), ["focus", "hand back"]);
}

#[test]
fn focus_the_user_moved_during_the_probes_is_not_taken_back() {
    let field = ScriptedField::new(true, true);
    assert!(!replace_whole_value(&field, "abc").unwrap());
    assert_eq!(field.calls(), ["focus"]);
}

#[test]
fn bringing_the_app_forward_during_the_selection_write_is_not_typed_over() {
    let field = ScriptedField {
        switches_on_select: true,
        ..ScriptedField::new(false, false)
    };
    assert!(!replace_whole_value(&field, "abc").unwrap());
    assert_eq!(field.calls(), ["focus", "select", "hand back"]);
}

#[test]
fn an_unanswered_focus_that_applied_is_handed_back_and_nothing_is_written() {
    let field = ScriptedField {
        focus_reply: AXError::CannotComplete,
        ..ScriptedField::new(false, false)
    };
    let error = replace_whole_value(&field, "abc").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxUnconfirmed);
    assert_eq!(field.calls(), ["focus", "hand back"]);
    assert!(!field.focused.get());
}

#[test]
fn an_unanswered_selection_hands_focus_back_and_skips_the_value_write() {
    let field = ScriptedField {
        select_reply: AXError::CannotComplete,
        ..ScriptedField::new(false, false)
    };
    let error = replace_whole_value(&field, "abc").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxUnconfirmed);
    assert_eq!(field.calls(), ["focus", "select", "hand back"]);
}

#[test]
fn a_refused_selection_still_falls_back_to_the_value_write() {
    let field = ScriptedField {
        select_reply: AXError::AttributeUnsupported,
        ..ScriptedField::new(false, false)
    };
    assert!(!replace_whole_value(&field, "abc").unwrap());
    assert_eq!(field.calls(), ["focus", "select", "hand back"]);
}

#[test]
fn a_user_typing_during_the_selection_write_gets_the_field_handed_back_and_nothing_written() {
    USER_TYPED.with(|typed| typed.set(false));
    let _watch = watch(press_check);
    let field = ScriptedField {
        types_on_select: Cell::new(true),
        ..ScriptedField::new(false, false)
    };
    let result = replace_whole_value(&field, "abc");
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::UserIntervened));
    assert_eq!(field.calls(), ["focus", "select", "hand back"]);
    USER_TYPED.with(|typed| typed.set(false));
    drop(_watch);
    assert!(check_press().is_ok(), "the watch is uninstalled after the call");
}

#[test]
fn a_refused_insertion_hands_a_borrowed_focus_back() {
    let field = ScriptedField {
        insert_reply: Some(ErrorCode::AxFailed),
        ..ScriptedField::new(false, false)
    };
    let error = replace_whole_value(&field, "abc").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert_eq!(field.calls(), ["focus", "select", "insert", "hand back"]);
    assert!(!field.focused.get());
    // A field that already held the focus keeps it.
    let own = ScriptedField {
        focused: Cell::new(true),
        insert_reply: Some(ErrorCode::AxFailed),
        ..ScriptedField::new(false, false)
    };
    assert!(replace_whole_value(&own, "abc").is_err());
    assert_eq!(own.calls(), ["select", "insert"]);
}
