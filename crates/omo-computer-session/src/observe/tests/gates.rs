//! Every gate of the diff table answers the full tree with its reason, never a diff.

use omo_computer_core::ax::{DiffFallback, NodeRead};
use omo_computer_core::observation::Observation;
use serde_json::{json, Value};

use super::{lines, run};
use crate::refs::testkit::{el, Node, Tree};
use crate::refs::RefRegistry;

fn page(title: &str) -> Node {
    let rows = (0..10).map(|i| el("button", &format!("Row {i}")).obj(100 + i)).collect();
    el("window", "W").obj(1).kids(vec![el("toolbar", title).obj(2).kids(vec![el("button", "Send").obj(3)]), el("list", "Items").obj(4).kids(rows)])
}

fn full(observation: &Observation, reason: DiffFallback) {
    assert_eq!(observation.diff_fallback, Some(reason));
    assert!(observation.diff.is_none() && observation.baseline.is_none(), "{reason:?}");
    assert!(observation.tree.is_some(), "{reason:?}");
}

fn read(refs: &mut RefRegistry, tree: &mut Tree, extra: Value) -> Observation {
    let mut params = extra;
    params["target"] = json!("w");
    run(refs, tree, params)
}

#[test]
fn expired_since_baseline_and_query_projection_return_full_tree() {
    let mut menu = page("Tools");
    menu.read = NodeRead { role: "menu".into(), ..menu.read };
    let mut tree = Tree::default().window("w", 1, vec![page("Tools"), page("Tools v2"), menu]).window("other", 2, vec![el("window", "O").obj(500)]);
    let mut refs = RefRegistry::default();
    let oldest = read(&mut refs, &mut tree, json!({})).generation;
    for _ in 0..7 {
        read(&mut refs, &mut tree, json!({}));
    }
    // The oldest of the eight is still a baseline (it is taken before the ninth ages it out).
    let edge = read(&mut refs, &mut tree, json!({"since": oldest}));
    assert_eq!((edge.diff_fallback, edge.baseline), (None, Some(oldest)));
    // ... and after that it is gone; so is a generation never minted for this window.
    full(&read(&mut refs, &mut tree, json!({"since": oldest})), DiffFallback::SinceExpired);
    full(&read(&mut refs, &mut tree, json!({"since": 999})), DiffFallback::SinceExpired);
    for _ in 0..12 {
        read(&mut refs, &mut tree, json!({}));
    }
    let other = run(&mut refs, &mut tree, json!({"target": "other"})).generation;
    assert!(refs.generation("w", other).is_none());
    full(&read(&mut refs, &mut tree, json!({"since": other})), DiffFallback::SinceExpired);

    // A query projection never diffs, and is never the baseline of a tree.
    let latest = read(&mut refs, &mut tree, json!({})).generation;
    let query = read(&mut refs, &mut tree, json!({"since": latest, "query": "Send"}));
    full(&query, DiffFallback::QueryProjection);
    let projected = query.tree.expect("projection");
    assert!(projected.contains("\"Send\"") && projected.contains("\"Tools\"") && !projected.contains("Row 3"), "{projected}");
    full(&read(&mut refs, &mut tree, json!({"since": query.generation})), DiffFallback::QueryProjection);

    // Incomplete baseline, incomplete current read.
    let complete = read(&mut refs, &mut tree, json!({})).generation;
    tree.hung.insert(4);
    let partial = read(&mut refs, &mut tree, json!({"since": complete}));
    full(&partial, DiffFallback::CurrentIncomplete);
    tree.hung.clear();
    full(&read(&mut refs, &mut tree, json!({"since": partial.generation})), DiffFallback::BaselineIncomplete);

    // A menu root, then the same window number in a relaunched process.
    let before_menu = read(&mut refs, &mut tree, json!({})).generation;
    tree.show("w", 2);
    full(&read(&mut refs, &mut tree, json!({"since": before_menu})), DiffFallback::MenuRoot);
    tree.show("w", 1);
    let before = read(&mut refs, &mut tree, json!({})).generation;
    tree.relaunch("w", 77);
    full(&read(&mut refs, &mut tree, json!({"since": before})), DiffFallback::WindowChanged);

    // With every gate open, the same window diffs.
    let open = read(&mut refs, &mut tree, json!({})).generation;
    let diff = read(&mut refs, &mut tree, json!({"since": open}));
    assert_eq!(diff.diff.as_deref().map(lines), Some(vec!["no changes"]));
}
