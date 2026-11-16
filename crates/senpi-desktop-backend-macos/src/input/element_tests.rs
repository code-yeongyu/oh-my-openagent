//! Keys addressed to an element go out only once the element holds its
//! application's keyboard focus (oh-my-pi 0838d2ab44 `keys_after_focus`).

use std::cell::Cell;
use std::time::Duration;

use senpi_desktop_core::backend::{AxInputMethod, ElementDelivery, KeyboardFocus};
use senpi_desktop_core::error::{DesktopError, ErrorCode};

use super::element::{inserts_first, keys_after_focus, ELEMENT_FOCUS_POLL, ELEMENT_FOCUS_TIMEOUT};

/// Time since element keys started, advanced by the test's waits and reads.
struct FocusClock(Cell<Duration>);

impl FocusClock {
    fn new() -> Self {
        Self(Cell::new(Duration::ZERO))
    }

    fn advance(&self, by: Duration) {
        self.0.set(self.0.get() + by);
    }

    fn remaining(&self) -> Option<Duration> {
        ELEMENT_FOCUS_TIMEOUT.checked_sub(self.0.get()).filter(|left| !left.is_zero())
    }
}

fn focus_in_window(id: &str) -> KeyboardFocus {
    KeyboardFocus {
        window: Some(id.to_owned()),
        element: None,
    }
}

#[test]
fn empty_text_is_done_without_an_insertion_or_keys() {
    // An empty AXSelectedText write deletes the field's selection, so empty
    // text is done at once, inserted.
    let done = inserts_first("", || panic!("an empty AXSelectedText write deletes the field's selection"));
    assert_eq!(done.unwrap(), Some(AxInputMethod::Inserted));
    // Other text tries the insertion, and keys follow only when it was not
    // attempted.
    assert_eq!(inserts_first("x", || Ok(true)).unwrap(), Some(AxInputMethod::Inserted));
    assert_eq!(inserts_first("x", || Ok(false)).unwrap(), None);
    let failed = inserts_first("x", || Err(DesktopError::ax_failed("read back differs"))).unwrap_err();
    assert_eq!(failed.code, ErrorCode::AxFailed);
}

#[test]
fn element_keys_wait_until_the_element_reports_focus() {
    let clock = FocusClock::new();
    let mut bounds = Vec::new();
    let sent = Cell::new(0);
    let delivery = keys_after_focus(
        || Ok(()),
        || clock.remaining(),
        |left| {
            bounds.push(left);
            bounds.len() == 3
        },
        |left| {
            clock.advance(ELEMENT_FOCUS_POLL.min(left));
            Ok(())
        },
        || panic!("a focused element needs no fresh read"),
        || {
            sent.set(sent.get() + 1);
            Ok(())
        },
    );
    assert!(matches!(delivery, Ok(ElementDelivery::Delivered(AxInputMethod::Keys))));
    // Each read may take only the time left.
    let ms = Duration::from_millis;
    assert_eq!(bounds, [ms(250), ms(240), ms(230)]);
    assert_eq!(sent.get(), 1);
}

#[test]
fn focus_is_confirmed_once_so_an_auto_advancing_code_input_fills() {
    // A field that moves focus to the next box as each digit lands keeps
    // receiving the rest: the focus read happens once, before the first key.
    let clock = FocusClock::new();
    let reads = Cell::new(0);
    let focused_box = Cell::new(0);
    let mut boxes = Vec::new();
    let delivery = keys_after_focus(
        || Ok(()),
        || clock.remaining(),
        |_| {
            reads.set(reads.get() + 1);
            focused_box.get() == 0
        },
        |_| panic!("the first box has focus at once"),
        || panic!("the first box took focus"),
        || {
            for _digit in 0..6 {
                boxes.push(focused_box.get());
                focused_box.set(focused_box.get() + 1);
            }
            Ok(())
        },
    );
    assert!(matches!(delivery, Ok(ElementDelivery::Delivered(AxInputMethod::Keys))));
    assert_eq!(boxes, [0, 1, 2, 3, 4, 5]);
    assert_eq!(reads.get(), 1);
}

#[test]
fn element_keys_are_never_sent_while_the_element_lacks_focus() {
    let clock = FocusClock::new();
    let polls = Cell::new(0);
    let delivery = keys_after_focus(
        || Ok(()),
        || clock.remaining(),
        |_| false,
        |left| {
            polls.set(polls.get() + 1);
            clock.advance(ELEMENT_FOCUS_POLL.min(left));
            Ok(())
        },
        || focus_in_window("9"),
        || panic!("nothing is sent to an element without focus"),
    );
    let Ok(ElementDelivery::Unfocused(focus)) = delivery else {
        panic!("an element that never took focus is refused");
    };
    assert_eq!(focus.window.as_deref(), Some("9"));
    assert_eq!(polls.get(), 25);
    // Cancelling the wait stops it with nothing sent either.
    let cancelled = keys_after_focus(
        || Ok(()),
        || Some(ELEMENT_FOCUS_TIMEOUT),
        |_| false,
        |_| Err(DesktopError::new(ErrorCode::Cancelled, "cancelled")),
        || panic!("a cancelled wait reads nothing"),
        || panic!("nothing is sent once the wait is cancelled"),
    );
    assert!(matches!(cancelled, Err(error) if error.code == ErrorCode::Cancelled));
}

#[test]
fn focus_reported_only_after_the_deadline_sends_nothing() {
    let refused = |elapsed_before_read: u64, read_takes: u64| {
        let clock = FocusClock::new();
        clock.advance(Duration::from_millis(elapsed_before_read));
        let fresh_reads = Cell::new(0);
        let sent = Cell::new(false);
        let delivery = keys_after_focus(
            || Ok(()),
            || clock.remaining(),
            |_| {
                clock.advance(Duration::from_millis(read_takes));
                true
            },
            |_| panic!("the first read answers"),
            || {
                fresh_reads.set(fresh_reads.get() + 1);
                KeyboardFocus::default()
            },
            || {
                sent.set(true);
                Ok(())
            },
        );
        let unfocused = matches!(delivery, Ok(ElementDelivery::Unfocused(_)));
        assert_eq!(fresh_reads.get(), usize::from(unfocused));
        assert_eq!(sent.get(), !unfocused);
        unfocused
    };
    // A read that answers yes after the deadline is no confirmation.
    assert!(refused(200, 60));
    assert!(refused(0, 250));
    // One that answers in time is, however close to the deadline.
    assert!(!refused(249, 0));
    assert!(!refused(200, 49));
    // So does a deadline that passed before the first read.
    assert!(refused(250, 0));
}

#[test]
fn a_refused_focus_setter_still_ends_in_the_focus_read() {
    let reads = Cell::new(0);
    let delivery = keys_after_focus(
        || Err(DesktopError::ax_failed("setting AXFocused=true failed")),
        || (reads.get() < 3).then_some(ELEMENT_FOCUS_TIMEOUT),
        |_| {
            reads.set(reads.get() + 1);
            false
        },
        |_| Ok(()),
        || focus_in_window("9"),
        || panic!("nothing is sent to an element without focus"),
    );
    let Ok(ElementDelivery::Unfocused(focus)) = delivery else {
        panic!("a refused setter ends in the refusal naming where focus is");
    };
    assert_eq!(focus.window.as_deref(), Some("9"));
    assert_eq!(reads.get(), 3);
    // A destroyed element is a stale ref at once.
    let gone = keys_after_focus(
        || Err(DesktopError::stale_ref("the element no longer exists")),
        || panic!("a destroyed element is not waited for"),
        |_| panic!("a destroyed element is not read"),
        |_| panic!("a destroyed element is not waited for"),
        || panic!("a destroyed element needs no focus read"),
        || panic!("nothing is sent to a destroyed element"),
    );
    assert!(matches!(gone, Err(error) if error.code == ErrorCode::StaleRef));
}
