//! Amendment A1's precedence across a whole read: every element whose native object is still
//! present keeps its number wherever a role + native id lookalike sits in the tree; a role +
//! native id match takes only a number no live object claimed; new elements get new numbers.

use std::collections::BTreeSet;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use serde_json::json;

use super::super::testkit::{el, Node, Tree};
use super::super::RefRegistry;
use super::{n_of, numbers, snap};
use crate::observe::{observe, Request};

fn run_full(refs: &mut RefRegistry, tree: &mut Tree, params: serde_json::Value) -> omo_computer_core::observation::Observation {
    let params = serde_json::from_value(params).expect("observe params");
    observe(refs, tree, &Request::read(params)).expect("observe")
}

fn window(children: Vec<Node>) -> Node {
    el("window", "W").obj(1).kids(vec![el("list", "L").obj(2).kids(children)])
}

/// Observes `v0` then `v1`; returns the registry and both generation numbers.
fn twice(v0: Vec<Node>, v1: Vec<Node>) -> (RefRegistry, u64, u64) {
    let mut tree = Tree::default().window("w", 1, vec![window(v0), window(v1)]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    tree.show("w", 1);
    let g2 = snap(&mut tree, &mut refs, "w");
    (refs, g1, g2)
}

fn all(refs: &RefRegistry, g: u64) -> BTreeSet<u64> {
    numbers(refs, "w", g).into_iter().map(|(_, n)| n).collect()
}

#[test]
fn a_live_object_keeps_its_number_wherever_a_role_and_id_lookalike_sits() {
    let go = || el("button", "Go").id("go").obj(21);
    let new = |title: &str, object: u64| el("button", title).id("go").obj(object);
    let placements: Vec<(&str, Vec<Node>)> = vec![
        ("lookalike before", vec![new("New 1", 40), go()]),
        ("lookalike after", vec![go(), new("New 1", 40)]),
        ("lookalikes on both sides", vec![new("New 1", 40), go(), new("New 2", 41)]),
        ("several lookalikes before", vec![new("New 1", 40), new("New 2", 41), go(), new("New 3", 42)]),
        ("the object moved under another id", vec![new("New 1", 40), el("button", "Go").id("go-old").obj(21)]),
    ];
    for (case, v1) in placements {
        let (refs, g1, g2) = twice(vec![go()], v1);
        assert_eq!(n_of(&refs, "w", g2, "Go"), n_of(&refs, "w", g1, "Go"), "{case}: the same native object keeps its number");
        let before = all(&refs, g1);
        for (title, n) in numbers(&refs, "w", g2).into_iter().filter(|(t, _)| t.starts_with("New")) {
            assert!(!before.contains(&n), "{case}: {title} took the number e{n} of an element still present");
        }
    }
}

#[test]
fn duplicate_native_ids_among_siblings_keep_every_live_row_numbered() {
    let row = |title: &str, object: u64| el("listitem", title).id("row").obj(object);
    let base = || vec![row("A", 21), row("B", 22), row("C", 23)];
    let edits: Vec<(&str, Vec<Node>)> = vec![
        ("insert at the top", vec![row("N", 40), row("A", 21), row("B", 22), row("C", 23)]),
        ("insert in the middle", vec![row("A", 21), row("N", 40), row("B", 22), row("C", 23)]),
        ("insert at the bottom", vec![row("A", 21), row("B", 22), row("C", 23), row("N", 40)]),
        ("remove the first, insert two", vec![row("N", 40), row("M", 41), row("B", 22), row("C", 23)]),
    ];
    for (case, v1) in edits {
        let (refs, g1, g2) = twice(base(), v1);
        for live in ["A", "B", "C"] {
            if numbers(&refs, "w", g2).iter().any(|(t, _)| t == live) {
                assert_eq!(n_of(&refs, "w", g2, live), n_of(&refs, "w", g1, live), "{case}: row {live}");
            }
        }
        let after: Vec<u64> = numbers(&refs, "w", g2).into_iter().map(|(_, n)| n).collect();
        assert_eq!(after.len(), after.iter().collect::<BTreeSet<_>>().len(), "{case}: one number per element");
    }
}

#[test]
fn a_recreated_object_takes_its_old_number_while_its_twin_lives() {
    let row = |title: &str, object: u64| el("listitem", title).id("row").obj(object);
    for (case, v1) in [
        ("recreated first", vec![row("A again", 50), row("B", 22)]),
        ("recreated last", vec![row("B", 22), row("A again", 50)]),
    ] {
        let (refs, g1, g2) = twice(vec![row("A", 21), row("B", 22)], v1);
        assert_eq!(n_of(&refs, "w", g2, "B"), n_of(&refs, "w", g1, "B"), "{case}: the live twin");
        assert_eq!(n_of(&refs, "w", g2, "A again"), n_of(&refs, "w", g1, "A"), "{case}: the only unclaimed role + id number");
    }
    // Two recreated rows and one old number left: the match is not unique, so neither inherits.
    let (refs, g1, g2) = twice(vec![row("A", 21), row("B", 22)], vec![row("X", 50), row("Y", 51), row("B", 22)]);
    let old = all(&refs, g1);
    let reused = ["X", "Y"].iter().filter(|t| old.contains(&n_of(&refs, "w", g2, t))).count();
    assert_eq!(reused, 0);
}

#[test]
fn an_insert_among_shared_ids_is_a_real_diff_not_a_reorder() {
    // The verifier's repro: rows sharing one AutomationId, a new row inserted at the top.
    let row = |title: &str, object: u64| el("listitem", title).id("row").obj(object);
    for (case, v1) in [
        ("top", vec![row("N", 40), row("A", 21), row("B", 22)]),
        ("middle", vec![row("A", 21), row("N", 40), row("B", 22)]),
        ("bottom", vec![row("A", 21), row("B", 22), row("N", 40)]),
    ] {
        let rows = (0..8).map(|i| el("button", &format!("Pad {i}")).obj(100 + i)).collect::<Vec<_>>();
        let mut v0 = vec![row("A", 21), row("B", 22)];
        v0.extend(rows.clone());
        let mut v1 = v1;
        v1.extend(rows);
        let mut tree = Tree::default().window("w", 1, vec![window(v0), window(v1)]);
        let mut refs = RefRegistry::default();
        let first = run_full(&mut refs, &mut tree, json!({"target": "w", "skeleton": false}));
        tree.show("w", 1);
        let second = run_full(&mut refs, &mut tree, json!({"target": "w", "skeleton": false, "since": first.generation}));
        assert_eq!(second.diff_fallback, None, "{case}");
        let diff = second.diff.expect("a diff");
        let changed: Vec<&str> = diff.lines().filter(|l| l.starts_with("~ ") || l.starts_with("+ ")).collect();
        assert_eq!(changed.len(), 1, "{case}:\n{diff}");
        assert!(changed[0].starts_with("+ - listitem \"N\""), "{case}:\n{diff}");
    }
}

#[test]
fn a_bare_never_minted_ref_is_unqualified_on_object_mode() {
    let mut tree = Tree::default().window("w", 1, vec![window(vec![el("button", "Send").obj(3)])]);
    let mut refs = RefRegistry::default();
    snap(&mut tree, &mut refs, "w");
    let unqualified = Refusal::new(EngineCode::InvalidTarget, Reason::RefUnqualified.wire());
    for token in ["e999", "e1", "e3"] {
        assert_eq!(refs.resolve(token, true, &mut tree).err().map(|u| u.refusal), Some(unqualified.clone()), "{token} on object mode");
    }
    assert_eq!(refs.resolve("e999", false, &mut tree).err().map(|u| u.refusal), Some(Refusal::bare(EngineCode::StaleRef)), "null mode: never minted");
    assert!(refs.resolve("e3", false, &mut tree).is_ok(), "null mode: a minted bare ref acts");
}
