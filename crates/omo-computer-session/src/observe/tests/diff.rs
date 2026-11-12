//! The diff itself: exactly the changed nodes, unchanged refs kept, a reorder answered with the
//! full tree, and a diff only when it is shorter than the tree.

use omo_computer_core::ax::DiffFallback;
use serde_json::json;

use crate::refs::testkit::{el, Node, Tree};
use super::{fixture, lines, run};
use crate::refs::RefRegistry;

fn changed(diff: &str) -> Vec<&str> {
    lines(diff).into_iter().filter(|line| line.starts_with("~ ") || line.starts_with("+ ")).collect()
}

#[test]
fn ax_diff_one_title_change() {
    let mut fake = fixture("v3-ax-diff-one-title-change.json");
    let mut refs = RefRegistry::default();
    let first = run(&mut refs, &mut fake, json!({"target": "101"}));
    let before = first.tree.expect("tree");
    let second = run(&mut refs, &mut fake, json!({"target": "101", "since": first.generation}));
    assert_eq!((second.tree.as_deref(), second.diff_fallback, second.baseline), (None, None, Some(first.generation)));
    let diff = second.diff.expect("a diff");
    let nodes = changed(&diff);
    assert_eq!(nodes.len(), 1, "exactly one diff node:\n{diff}");
    assert!(nodes[0].starts_with("~ - button \"Underline (on)\" [ref=s2:e"), "{diff}");
    assert!(!diff.contains("removed:"));
    // The changed element and every unchanged one keep their number; refs of both
    // generations resolve.
    let underline = before.lines().find(|line| line.contains("\"Underline\"")).expect("line");
    let n = underline.split("[ref=s1:").nth(1).and_then(|rest| rest.split(']').next()).expect("token");
    assert!(nodes[0].contains(&format!("[ref=s2:{n}]")));
    let bold = before.lines().find(|line| line.contains("\"Bold\"")).expect("bold");
    let bold_n = bold.split("[ref=s1:").nth(1).and_then(|rest| rest.split(']').next()).expect("token");
    for token in [format!("s2:{bold_n}"), format!("s1:{bold_n}")] {
        assert!(refs.resolve(&token, true, &mut fake).is_ok(), "{token}");
    }
}

#[test]
fn ax_diff_reorder_full_tree() {
    let mut fake = fixture("v3-ax-diff-reorder-full-tree.json");
    let mut refs = RefRegistry::default();
    let first = run(&mut refs, &mut fake, json!({"target": "101"}));
    let second = run(&mut refs, &mut fake, json!({"target": "101", "since": first.generation}));
    assert_eq!((second.diff.as_deref(), second.diff_fallback), (None, Some(DiffFallback::Reordered)));
    let tree = second.tree.expect("the full tree");
    let italic = tree.find("\"Italic\"").expect("italic");
    let bold = tree.find("\"Bold\"").expect("bold");
    assert!(italic < bold, "the tree shows the new order:\n{tree}");
}

fn buttons(order: &[u64]) -> Node {
    let kids = order.iter().map(|o| el("button", &format!("Button {o}")).obj(*o)).collect();
    el("window", "W").obj(1).kids(kids)
}

fn second_read(v0: Node, v1: Node, style: serde_json::Value) -> (Option<String>, Option<DiffFallback>) {
    let mut tree = Tree::default().window("w", 1, vec![v0, v1]);
    let mut refs = RefRegistry::default();
    let mut params = style.clone();
    params["target"] = json!("w");
    let first = run(&mut refs, &mut tree, params.clone());
    tree.show("w", 1);
    params["since"] = json!(first.generation);
    let second = run(&mut refs, &mut tree, params);
    assert_ne!(second.tree.is_some(), second.diff.is_some(), "a tree or a diff, never both");
    (second.diff, second.diff_fallback)
}

#[test]
fn diff_abandoned_when_surviving_order_changes() {
    let base: Vec<u64> = (10..22).collect();
    let mut swapped = base.clone();
    swapped.swap(3, 4);
    let mut moved = base.clone();
    let first = moved.remove(0);
    moved.push(first);
    for order in [swapped, moved] {
        assert_eq!(second_read(buttons(&base), buttons(&order), json!({})).1, Some(DiffFallback::Reordered), "{order:?}");
    }
    // Removals and insertions that keep the survivors' order are a diff.
    let mut edited: Vec<u64> = base.iter().copied().filter(|o| *o != 15).collect();
    edited.insert(2, 99);
    let (diff, fallback) = second_read(buttons(&base), buttons(&edited), json!({}));
    assert_eq!(fallback, None);
    let diff = diff.expect("diff");
    assert_eq!(changed(&diff).len(), 1, "{diff}");
    assert!(diff.contains("+ - button \"Button 99\"") && diff.contains("removed: e"), "{diff}");
}

#[test]
fn diff_only_when_shorter_than_full() {
    // Elements with no native object and no id get new numbers at every read: everything is
    // added and removed, and that diff is longer than the tree.
    let anonymous = |title: &str| el("window", "W").kids((0..6).map(|i| el("button", &format!("{title} {i}"))).collect());
    assert_eq!(second_read(anonymous("A"), anonymous("A"), json!({})).1, Some(DiffFallback::NotShorter));
    // An identical tree answers the one-line no-change form.
    let (diff, fallback) = second_read(buttons(&[10, 11, 12]), buttons(&[10, 11, 12]), json!({}));
    assert_eq!(fallback, None);
    assert_eq!(lines(&diff.expect("diff")), vec!["no changes"]);
    // A large tree with one change is a short diff.
    let wide: Vec<u64> = (10..40).collect();
    let mut one = buttons(&wide);
    one.children[7] = el("button", "Renamed").obj(17);
    let (diff, _) = second_read(buttons(&wide), one, json!({"skeleton": false}));
    assert_eq!(changed(&diff.expect("diff")).len(), 1);
}
