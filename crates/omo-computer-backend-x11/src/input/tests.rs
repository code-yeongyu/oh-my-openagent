//! Row 49's planner tests: the active group, the unresolvable default and its opt-in remap
//! (AC-81), graphemes, the C0 controls and the scratch keycode's freedom in every group.

use std::collections::BTreeSet;

use omo_computer_core::error::{EngineCode, Reason};
use serde_json::json;

use super::keys::{keysym, plan, GroupMap, Step};

pub(super) const GA: &str = "\u{ac00}";
const ZHE: &str = "\u{436}";

fn ks(grapheme: &str) -> u32 {
    keysym(grapheme).expect("one keysym")
}

/// Group 0 is a US row (`a`, `x`, Return) plus keycode 11; group 1 holds a Cyrillic letter.
pub(super) fn map(free: bool) -> GroupMap {
    let last = if free { [0, 0] } else { [ks("q"), ks("Q")] };
    GroupMap::new(
        8,
        vec![
            vec![[ks("a"), ks("A")], [ks(ZHE), 0]],
            vec![[ks("x"), ks("X")], [0, 0]],
            vec![[ks("\n"), 0], [0, 0]],
            vec![last, [0, 0]],
        ],
        &BTreeSet::new(),
    )
}

#[test]
fn grapheme_resolves_in_active_group_only() {
    assert_eq!(map(true).resolve(1, ks(ZHE)), Some((8, false)));
    assert_eq!(
        map(true).resolve(0, ks(ZHE)),
        None,
        "group 1's letter is not in group 0"
    );
    assert_eq!(map(true).resolve(0, ks("X")), Some((9, true)));
}

#[test]
fn unresolvable_grapheme_is_refused_with_next_call_paste_by_default() {
    let refusal = plan(&map(true), 0, &format!("a{GA}"), false).expect_err("refused");
    assert_eq!(
        (refusal.code, refusal.reason),
        (EngineCode::InvalidKey, Some(Reason::Unresolvable))
    );
    assert_eq!(
        refusal.data.as_deref(),
        Some(&json!({ "group": 0, "grapheme": GA }))
    );
    let row = refusal.row().expect("table row");
    assert_eq!(
        row.next_call,
        omo_computer_core::error::NextCall::Call("win.paste(text)")
    );
}

#[test]
fn with_keymap_remap_on_unresolvable_graphemes_are_typed_through_scratch_keycodes_and_restored() {
    assert_eq!(
        plan(&map(true), 0, &format!("{GA}x"), true),
        Ok(vec![
            Step::Remap {
                code: 11,
                keysym: ks(GA)
            },
            Step::Key {
                code: 11,
                shift: false
            },
            Step::Restore { code: 11 },
            Step::Key {
                code: 9,
                shift: false
            },
        ]),
        "one remap per grapheme, `x` through the map"
    );
}

#[test]
fn remap_refused_answers_unresolvable_with_nothing_sent() {
    let refused = plan(&map(false), 0, &format!("x{GA}"), true).expect_err("no free keycode");
    assert_eq!(refused.reason, Some(Reason::Unresolvable));
    assert_eq!(
        refused.data.as_deref(),
        Some(&json!({ "group": 0, "grapheme": GA })),
        "the `x` before it is not planned"
    );
}

#[test]
fn a_keycode_free_in_the_active_group_but_mapped_in_another_is_never_the_scratch() {
    let mut keys = map(true).keys;
    keys[3] = vec![[0, 0], [ks(ZHE), 0]];
    let busy = GroupMap::new(8, keys.clone(), &BTreeSet::new());
    assert_eq!(
        plan(&busy, 0, GA, true).map_err(|refusal| refusal.reason),
        Err(Some(Reason::Unresolvable))
    );
    keys[3] = vec![[0, 0], [0, 0]];
    let modifier = GroupMap::new(8, keys, &BTreeSet::from([11]));
    assert!(
        plan(&modifier, 0, GA, true).is_err(),
        "a keycode bound to a modifier is not free either"
    );
}

#[test]
fn a_combining_sequence_is_one_grapheme_refused_whole() {
    let decomposed = "e\u{301}";
    let refusal = plan(&map(true), 0, decomposed, true).expect_err("no single keysym");
    assert_eq!(
        refusal.data.as_deref(),
        Some(&json!({ "group": 0, "grapheme": decomposed }))
    );
    let family = "\u{1f468}\u{200d}\u{1f469}";
    assert_eq!(
        plan(&map(true), 0, family, true)
            .expect_err("ZWJ")
            .data
            .as_deref(),
        Some(&json!({ "group": 0, "grapheme": family }))
    );
}

#[test]
fn newline_tab_and_backspace_are_their_own_keys() {
    assert_eq!(keysym("\n"), Some(0xff0d));
    assert_eq!(
        keysym("\r\n"),
        Some(0xff0d),
        "CRLF is one grapheme, one Return"
    );
    assert_eq!(keysym("\t"), Some(0xff09));
    assert_eq!(keysym("\u{8}"), Some(0xff08));
    assert_eq!(keysym("\u{7}"), None, "a control no key types");
    assert_eq!(
        plan(&map(true), 0, "a\nx", false),
        Ok(vec![
            Step::Key {
                code: 8,
                shift: false
            },
            Step::Key {
                code: 10,
                shift: false
            },
            Step::Key {
                code: 9,
                shift: false
            }
        ])
    );
}
