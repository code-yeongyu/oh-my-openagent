//! A role + native id match inherits a number only when the match is unique and the old entry
//! is not live under another native object: a returning old object never takes back a number
//! a live lookalike held in the previous read, and a drill never gives a lookalike the number
//! of a live element outside the drilled subtree.

use std::collections::BTreeMap;

use serde_json::json;

use super::super::testkit::{el, Node, Tree};
use super::super::RefRegistry;
use crate::observe::{drill, observe, Request};

pub(super) fn list(children: Vec<Node>) -> Node {
    el("window", "W").obj(1).kids(vec![el("list", "L").obj(2).kids(children)])
}

pub(super) fn read(refs: &mut RefRegistry, tree: &mut Tree, since: Option<u64>) -> omo_computer_core::observation::Observation {
    let mut params = json!({"target": "w", "skeleton": false});
    if let Some(since) = since {
        params["since"] = json!(since);
    }
    let params = serde_json::from_value(params).expect("observe params");
    observe(refs, tree, &Request::read(params)).expect("observe")
}

/// object -> n of one generation (elements that report an object).
pub(super) fn holders(refs: &RefRegistry, generation: u64) -> BTreeMap<u64, u64> {
    let generation = refs.generation("w", generation).expect("generation");
    generation.entries.iter().filter_map(|e| e.object.map(|o| (o.0, e.n))).collect()
}

#[test]
fn a_returning_object_never_takes_the_number_a_live_lookalike_held_last() {
    let row = |title: &str, object: u64| el("listitem", title).id("row").obj(object);
    let pad = || (0..6).map(|i| el("button", &format!("Pad {i}")).obj(100 + i)).collect::<Vec<_>>();
    let with_pad = |mut rows: Vec<Node>| {
        rows.extend(pad());
        list(rows)
    };
    for (case, s3) in [
        ("A returns above N", vec![row("A", 21), row("N", 40)]),
        ("A returns below N", vec![row("N", 40), row("A", 21)]),
    ] {
        let mut tree = Tree::default().window("w", 1, vec![with_pad(vec![row("A", 21)]), with_pad(vec![row("N", 40)]), with_pad(s3)]);
        let mut refs = RefRegistry::default();
        let first = read(&mut refs, &mut tree, None);
        tree.show("w", 1);
        let second = read(&mut refs, &mut tree, Some(first.generation));
        let n_held = holders(&refs, second.generation)[&40];
        assert_eq!(n_held, holders(&refs, first.generation)[&21], "rule (2) gives N the number A held");
        tree.show("w", 2);
        let third = read(&mut refs, &mut tree, Some(second.generation));
        let now = holders(&refs, third.generation);
        assert_eq!(now[&40], n_held, "{case}: N held e{n_held} in the previous read and keeps it");
        assert_ne!(now[&21], n_held, "{case}: the returning A gets a fresh number");
        let diff = third.diff.unwrap_or_else(|| panic!("{case}: {:?}", third.diff_fallback));
        assert!(!diff.lines().any(|l| l.starts_with("~ ")), "{case}: no element is relabelled:\n{diff}");
        assert!(diff.lines().any(|l| l.starts_with("+ - listitem \"A\"")), "{case}: A is added:\n{diff}");
        for token in [format!("s{}:e{n_held}", second.generation), format!("s{}:e{n_held}", third.generation)] {
            let resolved = refs.resolve(&token, true, &mut tree).expect("resolves");
            assert_eq!(resolved.live.title.as_deref(), Some("N"), "{case}: {token} names N");
        }
    }
}

#[test]
fn a_drill_never_gives_a_lookalike_the_number_of_a_live_element_outside_its_subtree() {
    // X lives outside group G; the drilled G gains a lookalike Y (same role and native id).
    for (case, x, y) in [
        ("objects", el("listitem", "X").id("row").obj(21), el("listitem", "Y").id("row").obj(99)),
        ("no objects", el("listitem", "X").id("row"), el("listitem", "Y").id("row")),
    ] {
        let group = |kids: Vec<Node>| el("group", "G").obj(3).kids(kids);
        let v0 = el("window", "W").obj(1).kids(vec![x.clone(), group(vec![el("button", "k").obj(4)])]);
        let v1 = el("window", "W").obj(1).kids(vec![x.clone(), group(vec![el("button", "k").obj(4), y.clone()])]);
        let mut tree = Tree::default().window("w", 1, vec![v0, v1]);
        let mut refs = RefRegistry::default();
        let full = read(&mut refs, &mut tree, None);
        let parent = refs.generation("w", full.generation).expect("parent");
        let at = |title: &str| parent.entries.iter().position(|e| e.read.title.as_deref() == Some(title)).expect(title);
        let (x_token, g_token) = (parent.token(at("X")), parent.token(at("G")));
        let (x_n, n_k) = (parent.entries[at("X")].n, parent.entries[at("k")].n);
        tree.show("w", 1);
        let drilled = drill(&mut refs, &mut tree, &g_token, None, true).expect("drill");
        let sub = refs.generation("w", drilled.generation).expect("sub-generation");
        let y_n = sub.entries.iter().find(|e| e.read.title.as_deref() == Some("Y")).expect("Y").n;
        assert_ne!(y_n, x_n, "{case}: Y must not inherit e{x_n} of the live X outside the drill");
        let k_before = n_k;
        assert_eq!(sub.entries.iter().find(|e| e.read.title.as_deref() == Some("k")).map(|e| e.n), Some(k_before), "{case}: k inside the subtree keeps its number");
        let resolved = refs.resolve(&x_token, true, &mut tree).expect("X resolves");
        assert_eq!(resolved.live.title.as_deref(), Some("X"), "{case}");
    }
}
