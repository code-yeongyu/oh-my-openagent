//! Amendment A1: which element keeps its number across observations, and that no number is
//! ever given to a second element.

use std::collections::{BTreeMap, BTreeSet};

use super::super::testkit::{el, Tree};
use super::super::{Expiry, RefRegistry};
use super::{n_of, numbers, snap};

#[test]
fn ref_numbers_are_never_reused_in_a_session() {
    // Two windows; elements with an object, with a native id, and with neither.
    let a0 = el("window", "A").obj(1).kids(vec![
        el("button", "kept").obj(10),
        el("textfield", "by-id").id("email"),
        el("button", "anon-1"),
        el("button", "anon-2"),
    ]);
    let a1 = el("window", "A").obj(1).kids(vec![el("button", "anon-1"), el("button", "kept").obj(10), el("button", "new")]);
    let b0 = el("window", "B").obj(2).kids(vec![el("button", "kept").obj(10), el("button", "anon-1")]);
    let mut tree = Tree::default().window("a", 1, vec![a0, a1]).window("b", 2, vec![b0]);
    let mut refs = RefRegistry::default();
    let mut owner: BTreeMap<u64, String> = BTreeMap::new();
    let mut highest = 0;
    let record = |refs: &RefRegistry, window: &str, number: u64, owner: &mut BTreeMap<u64, String>| {
        let mut fresh = Vec::new();
        for (title, n) in numbers(refs, window, number) {
            let element = match title.as_str() {
                "kept" | "A" | "B" | "by-id" => format!("{window}/{title}"),
                _ => format!("{window}/{title}@s{number}"),
            };
            let previous = owner.insert(n, element.clone());
            if let Some(previous) = previous {
                assert_eq!(previous, element, "e{n} named two elements");
            } else {
                fresh.push(n);
            }
        }
        fresh
    };
    for round in 0..12 {
        tree.show("a", round % 2);
        let number = snap(&mut tree, &mut refs, "a");
        let fresh = record(&refs, "a", number, &mut owner);
        assert!(fresh.iter().all(|n| *n > highest), "a fresh number is above every earlier one: {fresh:?} vs {highest}");
        let number = snap(&mut tree, &mut refs, "b");
        record(&refs, "b", number, &mut owner);
        highest = owner.keys().copied().max().unwrap_or(0);
    }
    // The same native object in two windows is two elements with two numbers.
    assert_ne!(n_of(&refs, "a", refs.latest("a").expect("a").number, "kept"), n_of(&refs, "b", refs.latest("b").expect("b").number, "kept"));
    // After an expiry nothing carries over and nothing is reused.
    refs.expire("a", Expiry::Epoch);
    let number = snap(&mut tree, &mut refs, "a");
    let after: BTreeSet<u64> = numbers(&refs, "a", number).into_iter().map(|(_, n)| n).collect();
    assert!(after.iter().all(|n| *n > highest), "{after:?} reuses a number at or below {highest}");
}

#[test]
fn same_native_object_keeps_its_number() {
    let v0 = el("window", "W").obj(1).kids(vec![el("button", "Save").obj(10).at(0.0, 0.0), el("button", "Open").obj(11)]);
    let v1 = el("window", "W").obj(1).kids(vec![
        el("link", "Open").obj(11),
        el("button", "Save as").obj(10).at(50.0, 0.0),
        el("button", "Save").obj(12).at(0.0, 0.0),
    ]);
    let mut tree = Tree::default().window("w", 1, vec![v0, v1]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    tree.show("w", 1);
    let g2 = snap(&mut tree, &mut refs, "w");
    assert_eq!(n_of(&refs, "w", g2, "Save as"), n_of(&refs, "w", g1, "Save"), "retitled and moved, same object");
    assert_eq!(n_of(&refs, "w", g2, "Open"), n_of(&refs, "w", g1, "Open"), "a new role on the same object");
    assert_eq!(n_of(&refs, "w", g2, "W"), n_of(&refs, "w", g1, "W"));
    let lookalike = n_of(&refs, "w", g2, "Save");
    assert!(numbers(&refs, "w", g1).iter().all(|(_, n)| *n != lookalike), "a lookalike object never takes a number");
}

#[test]
fn role_and_native_id_keeps_its_number_when_object_recreated() {
    let v0 = el("window", "W").obj(1).kids(vec![
        el("textfield", "Email").id("email").obj(20),
        el("button", "Go").id("go").obj(21),
        el("button", "Plain").obj(22),
    ]);
    let v1 = el("window", "W").obj(1).kids(vec![
        el("textfield", "Email (required)").id("email").obj(30),
        el("button", "Go").id("go").obj(31),
        el("button", "Go again").id("go").obj(32),
        el("link", "Email link").id("email").obj(33),
        el("button", "Plain").obj(34),
    ]);
    let mut tree = Tree::default().window("w", 1, vec![v0, v1]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    tree.show("w", 1);
    let g2 = snap(&mut tree, &mut refs, "w");
    let before: BTreeSet<u64> = numbers(&refs, "w", g1).into_iter().map(|(_, n)| n).collect();
    assert_eq!(n_of(&refs, "w", g2, "Email (required)"), n_of(&refs, "w", g1, "Email"), "same role and native id");
    assert_eq!(n_of(&refs, "w", g2, "Go"), n_of(&refs, "w", g1, "Go"));
    for fresh in ["Go again", "Email link", "Plain"] {
        let n = n_of(&refs, "w", g2, fresh);
        assert!(!before.contains(&n), "{fresh}: a used number, another role, or no native id gets a new number");
    }
}
