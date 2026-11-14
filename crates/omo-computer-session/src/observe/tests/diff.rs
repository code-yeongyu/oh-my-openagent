//! The diff itself: exactly the changed nodes, unchanged refs kept, a reorder answered with the
//! full tree, and a diff only when it is shorter than the tree.

use omo_computer_core::ax::DiffFallback;
use serde_json::json;

use crate::refs::testkit::{el, Node, Tree};
use super::{fixture, lines, run};
use crate::refs::RefRegistry;

fn changed(diff: &str) -> Vec<&str> {
    lines(diff).into_iter().filter(|line| line.starts_with("~ ") || line.starts_with('+')).collect()
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
    assert!(diff.contains(") - button \"Button 99\"") && diff.contains("+(under e") && diff.contains("removed: e"), "{diff}");
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

/// `[ref=s<g>:e<n>]` -> `n`.
fn ref_n(line: &str) -> u64 {
    let after = line.split("[ref=s").nth(1).expect("a ref");
    let digits: String = after.split(":e").nth(1).expect("an element").chars().take_while(char::is_ascii_digit).collect();
    digits.parse().expect("an element number")
}

/// A tree's lines with the generation dropped from every ref (`[ref=s3:e7]` -> `[ref=e7]`).
fn normalised(tree: &str) -> Vec<String> {
    lines(tree)
        .into_iter()
        .map(|line| {
            let mut out = String::new();
            let mut rest = line;
            while let Some(at) = rest.find("[ref=s") {
                out.push_str(&rest[..at + 5]);
                rest = &rest[at + 5..];
                rest = &rest[rest.find(':').expect("ref colon") + 1..];
            }
            out.push_str(rest);
            out
        })
        .collect()
}

struct Placed {
    n: u64,
    parent: Option<u64>,
    body: String,
}

/// A run being applied: the insert position, the first line's indentation, the run's parent and
/// the open ancestors (indentation, element) of the line being read.
struct Run {
    at: usize,
    base: usize,
    parent: Option<u64>,
    stack: Vec<(usize, u64)>,
}

/// The place in `(under e<p> after e<n>)`: the parent (None for the root) and the preceding
/// surviving sibling (None for `first`).
fn place(spec: &str) -> (Option<u64>, Option<u64>) {
    let mut parent = None;
    let mut after = None;
    let words: Vec<&str> = spec.split(' ').collect();
    let mut i = 0;
    while i < words.len() {
        match words[i] {
            "under" => {
                parent = Some(words[i + 1][1..].parse().expect("parent number"));
                i += 2;
            }
            "after" => {
                after = Some(words[i + 1][1..].parse().expect("after number"));
                i += 2;
            }
            "first" => i += 1,
            other => panic!("unknown place word {other:?} in {spec:?}"),
        }
    }
    (parent, after)
}

/// Applies `diff` (A-IS-59 grammar) to `old`, the baseline's full tree: what a reader holding
/// only those two can rebuild.
fn apply(old: &str, diff: &str) -> Vec<String> {
    let mut tree: Vec<Placed> = Vec::new();
    let mut ancestors: Vec<u64> = Vec::new();
    for line in lines(old) {
        let depth = (line.len() - line.trim_start().len()) / 2;
        ancestors.truncate(depth);
        let n = ref_n(line);
        tree.push(Placed { n, parent: ancestors.last().copied(), body: line.trim_start().to_owned() });
        ancestors.push(n);
    }
    let subtree_end = |tree: &[Placed], at: usize| {
        let mut end = at + 1;
        let mut inside = vec![tree[at].n];
        while end < tree.len() && tree[end].parent.is_some_and(|p| inside.contains(&p)) {
            inside.push(tree[end].n);
            end += 1;
        }
        end
    };
    let mut removed: Vec<u64> = Vec::new();
    let mut run: Option<Run> = None;
    for line in lines(diff) {
        if let Some(rest) = line.strip_prefix("+(") {
            let (spec, body) = rest.split_once(") ").expect("+(place) body");
            let (parent, after) = place(spec);
            let at = match after {
                Some(sibling) => subtree_end(&tree, tree.iter().position(|l| l.n == sibling).expect("the sibling survives")),
                None => parent.map_or(0, |p| tree.iter().position(|l| l.n == p).expect("the parent survives") + 1),
            };
            let n = ref_n(body);
            tree.insert(at, Placed { n, parent, body: body.to_owned() });
            run = Some(Run { at: at + 1, base: 0, parent, stack: vec![(0, n)] });
        } else if let Some(rest) = line.strip_prefix("+ ") {
            let Run { at, base, parent, stack } = run.as_mut().expect("a bare '+' line continues a run");
            let indent = (rest.len() - rest.trim_start().len()) / 2 + *base;
            stack.retain(|(depth, _)| *depth < indent);
            let up = stack.last().map_or(*parent, |(_, n)| Some(*n));
            let up = if indent == *base { *parent } else { up };
            let body = rest.trim_start();
            let n = ref_n(body);
            tree.insert(*at, Placed { n, parent: up, body: body.to_owned() });
            *at += 1;
            stack.push((indent, n));
        } else if let Some(body) = line.strip_prefix("~ ") {
            let n = ref_n(body);
            tree.iter_mut().find(|l| l.n == n).expect("a changed line survives").body = body.to_owned();
            run = None;
        } else if let Some(list) = line.strip_prefix("removed: ") {
            for span in list.split(", ") {
                let (from, to) = span.split_once('-').unwrap_or((span, span));
                let (from, to): (u64, u64) = (from[1..].parse().expect("from"), to[1..].parse().expect("to"));
                removed.extend(from..=to);
            }
        }
    }
    tree.retain(|l| !removed.contains(&l.n));
    let depth = |n: u64| {
        let mut depth = 0;
        let mut up = tree.iter().find(|l| l.n == n).and_then(|l| l.parent);
        while let Some(p) = up {
            depth += 1;
            up = tree.iter().find(|l| l.n == p).and_then(|l| l.parent);
        }
        depth
    };
    let rebuilt: Vec<String> = tree.iter().map(|l| format!("{}{}", "  ".repeat(depth(l.n)), l.body)).collect();
    normalised(&rebuilt.join("\n"))
}

/// The baseline's tree, the diff since it, and the current tree.
fn three_reads(v0: Node, v1: Node) -> (String, Option<String>, Option<DiffFallback>, String) {
    let mut tree = Tree::default().window("w", 1, vec![v0, v1]);
    let mut refs = RefRegistry::default();
    let style = json!({"target": "w", "skeleton": false});
    let first = run(&mut refs, &mut tree, style.clone());
    tree.show("w", 1);
    let mut since = style.clone();
    since["since"] = json!(first.generation);
    let second = run(&mut refs, &mut tree, since);
    let now = run(&mut refs, &mut tree, style).tree.expect("the full tree now");
    (first.tree.expect("the baseline tree"), second.diff, second.diff_fallback, now)
}

/// A-IS-59's tests of record: the diff applied to the baseline rebuilds the current tree.
#[test]
fn a_diff_applied_to_the_baseline_rebuilds_the_current_tree() {
    let window = |kids: Vec<Node>| el("window", "W").obj(1).kids(kids);
    let button = |o: u64| el("button", &format!("Button {o}")).obj(o);
    let four: Vec<Node> = (10..14).map(button).collect();
    let mut at_two = four.clone();
    at_two.insert(2, button(99));
    let mut first = four.clone();
    first.insert(0, button(98));
    let mut two_runs = four.clone();
    two_runs.insert(3, button(97));
    two_runs.insert(1, button(96));
    let mut next_to_removal: Vec<Node> = (10..14).filter(|o| *o != 12).map(button).collect();
    next_to_removal.insert(2, el("group", "New").obj(95).kids(vec![button(94), button(93)]));
    let cases = [
        ("insert at index 2 of 4", at_two, 1),
        ("insert as first child", first, 1),
        ("two insertions under one parent", two_runs, 2),
        ("an insertion next to a removal", next_to_removal, 1),
    ];
    for (case, v1, runs) in cases {
        let (old, diff, fallback, now) = three_reads(window(four.clone()), window(v1));
        let diff = diff.unwrap_or_else(|| panic!("{case}: a diff, got {fallback:?}"));
        assert_eq!(lines(&diff).iter().filter(|l| l.starts_with("+(")).count(), runs, "{case}: one place per run:\n{diff}");
        assert_eq!(apply(&old, &diff), normalised(&now), "{case}:\n{diff}");
    }
}

/// A-IS-59: a survivor whose rendered parent changed is a move: the full tree, 'reordered'.
/// An anonymous single-child wrapper the noise filter removes is not a parent: no change.
#[test]
fn a_named_container_around_a_survivor_is_reordered_and_an_anonymous_wrapper_is_no_change() {
    let window = |kids: Vec<Node>| el("window", "W").obj(1).kids(kids);
    let button = |o: u64| el("button", &format!("Button {o}")).obj(o);
    let four: Vec<Node> = (10..14).map(button).collect();
    let mut named = four.clone();
    named[1] = el("group", "Tools").obj(50).kids(vec![button(11)]);
    let (_, diff, fallback, _) = three_reads(window(four.clone()), window(named));
    assert_eq!((diff.as_deref(), fallback), (None, Some(DiffFallback::Reordered)));
    let mut wrapped = four.clone();
    wrapped[1] = el("group", "").kids(vec![button(11)]);
    let (_, diff, fallback, _) = three_reads(window(four.clone()), window(wrapped));
    assert_eq!(fallback, None);
    assert_eq!(lines(&diff.expect("a diff")), vec!["no changes"]);
}
