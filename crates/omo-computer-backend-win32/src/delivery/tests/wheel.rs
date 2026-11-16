//! The posted wheel delivers what the delta asks for, and its report says so (core `pointer.rs`:
//! the backend converts a delta to steps and nothing is clamped silently): a zero delta posts
//! nothing, both axes of a diagonal delta are posted, and past the per-call cap of
//! [`MAX_NOTCHES`] the report counts what went out of what was asked.

use omo_computer_core::backend::{Delivered, InputEvent};
use omo_computer_core::params::Point;

use crate::delivery::messages::{MAX_NOTCHES, WM_MOUSEHWHEEL, WM_MOUSEWHEEL};
use crate::delivery::post::Deliverer;

use super::keys::form;
use super::kit::ScriptedOs;

const FORM: &str = "0x400";

/// A deliverer with a pointer position on the form, and the form's posts after that move.
fn scrolled(dx: f64, dy: f64) -> (Result<Delivered, String>, ScriptedOs) {
    let mut os = form(None, Vec::new());
    let mut deliverer = Deliverer::default();
    deliverer
        .deliver(
            &mut os,
            FORM,
            &InputEvent::PointerMove(Point { x: 140.0, y: 220.0 }),
        )
        .expect("move");
    os.posts.clear();
    let result = deliverer
        .deliver(&mut os, FORM, &InputEvent::Scroll { dx, dy })
        .map_err(|refusal| format!("{refusal:?}"));
    (result, os)
}

fn delta(wparam: usize) -> i16 {
    u16::try_from(wparam >> 16).unwrap_or_default().cast_signed()
}

#[test]
fn a_zero_delta_posts_nothing() {
    let (result, os) = scrolled(0.0, 0.0);
    assert_eq!(result, Ok(Delivered { count: 0, of: 0 }));
    assert!(os.posts.is_empty(), "{:?}", os.messages());
}

#[test]
fn a_diagonal_delta_posts_both_axes() {
    let (result, os) = scrolled(-250.0, 150.0);
    assert_eq!(result, Ok(Delivered { count: 5, of: 5 }));
    let vertical: Vec<i16> = os
        .posts
        .iter()
        .filter(|(_, posted)| posted.msg == WM_MOUSEWHEEL)
        .map(|(_, posted)| delta(posted.wparam))
        .collect();
    let horizontal: Vec<i16> = os
        .posts
        .iter()
        .filter(|(_, posted)| posted.msg == WM_MOUSEHWHEEL)
        .map(|(_, posted)| delta(posted.wparam))
        .collect();
    assert_eq!(vertical, [-120, -120], "down is toward the user");
    assert_eq!(horizontal, [-120, -120, -120], "left");
}

#[test]
fn past_the_cap_the_report_counts_what_went_out_of_what_was_asked() {
    let (result, os) = scrolled(0.0, 5_000.0);
    assert_eq!(
        result,
        Ok(Delivered {
            count: MAX_NOTCHES,
            of: 50
        })
    );
    assert_eq!(os.posts.len(), 40);
    let (both, os) = scrolled(3_000.0, 3_000.0);
    assert_eq!(
        both,
        Ok(Delivered {
            count: MAX_NOTCHES,
            of: 60
        })
    );
    assert_eq!(os.posts.len(), 40);
}
