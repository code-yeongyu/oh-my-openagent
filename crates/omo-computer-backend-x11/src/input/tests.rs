//! Row 49's RED list for input: XTEST under the lease, user-held keys, the active group, and the
//! unresolvable-grapheme default and its opt-in remap (AC-81).

use std::collections::BTreeSet;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::holds::release_plan;
use super::keys::{keysym, plan, resolve, GroupMap, Step, Unresolvable};
use super::xtest::admit;

const GA: char = '\u{ac00}';
const ZHE: char = '\u{436}';

/// Group 0 is a US row (`a`, `x`) plus one free keycode; group 1 holds a Cyrillic letter.
fn map(free: bool) -> GroupMap {
    let blank = if free { [0, 0] } else { [keysym('q'), keysym('Q')] };
    GroupMap {
        min_keycode: 8,
        keys: vec![
            vec![[keysym('a'), keysym('A')], [keysym(ZHE), 0]],
            vec![[keysym('x'), keysym('X')], [0, 0]],
            vec![blank, [0, 0]],
        ],
    }
}

#[test]
fn xtest_requires_foreground_lease() {
    assert_eq!(
        admit(false),
        Err(Refusal::new(EngineCode::ControlRequired, Reason::LeaseMissing.wire()))
    );
    assert_eq!(admit(true), Ok(()));
}

#[test]
fn user_held_key_is_not_released() {
    let ours = BTreeSet::from([20, 21]);
    let held = BTreeSet::from([21, 30]);
    assert_eq!(release_plan(&ours, &held), vec![20]);
}

#[test]
fn grapheme_resolves_in_active_group_only() {
    assert_eq!(resolve(&map(true), 1, keysym(ZHE)), Some((8, false)));
    assert_eq!(resolve(&map(true), 0, keysym(ZHE)), None, "group 1's letter is not in group 0");
    assert_eq!(resolve(&map(true), 0, keysym('X')), Some((9, true)));
}

#[test]
fn unresolvable_grapheme_is_refused_with_next_call_paste_by_default() {
    assert_eq!(
        plan(&map(true), 0, &format!("a{GA}"), false),
        Err(Unresolvable {
            refusal: Refusal::new(EngineCode::InvalidKey, Reason::Unresolvable.wire()),
            group: 0,
            grapheme: GA.to_string(),
            next_call: "paste",
        })
    );
}

#[test]
fn with_keymap_remap_on_unresolvable_graphemes_are_typed_through_scratch_keycodes_and_restored() {
    assert_eq!(
        plan(&map(true), 0, &format!("{GA}x"), true),
        Ok(vec![
            Step::Remap { code: 10, keysym: keysym(GA) },
            Step::Key { code: 10, shift: false },
            Step::Restore { code: 10 },
            Step::Key { code: 9, shift: false },
        ]),
        "one remap per grapheme, `x` through the map"
    );
}

#[test]
fn remap_refused_answers_unresolvable_with_nothing_sent() {
    let refused = plan(&map(false), 0, &format!("x{GA}"), true);
    assert_eq!(
        refused.map_err(|unresolvable| (unresolvable.refusal.reason, unresolvable.grapheme)),
        Err((Some("unresolvable"), GA.to_string())),
        "no free keycode: the whole call is refused, the `x` before it included"
    );
}
