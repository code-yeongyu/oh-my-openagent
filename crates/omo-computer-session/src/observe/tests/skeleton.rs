//! The default read is the skeleton with actions off; `find` answers from the whole snapshot;
//! `drill` opens a cut in a sub-generation; a dense window's partial read flags every cut.

use serde_json::json;

use super::super::{drill, find, Criteria, Style};
use super::{fixture, lines, request, run};
use crate::refs::RefRegistry;

const SKELETON: &str = "v3-observe-default-is-skeleton.json";

/// Logical depth of a rendered line: two spaces per level.
fn level(line: &str) -> usize {
    (line.len() - line.trim_start().len()) / 2
}

#[test]
fn observe_default_is_skeleton_with_actions_off() {
    assert_eq!(request(json!({"target": "101"})).style, Style { skeleton: true, depth: None, actions: false });
    let mut fake = fixture(SKELETON);
    let mut refs = RefRegistry::default();

    let default = run(&mut refs, &mut fake, json!({"target": "101"}));
    assert_eq!((default.nodes_observed, default.complete), (500, true));
    let tree = default.tree.expect("a tree");
    let shown = lines(&tree);
    assert_eq!(shown.iter().map(|line| level(line)).max(), Some(3), "logical depth 3:\n{tree}");
    assert!(shown.iter().any(|line| line.trim_start().starts_with("- group \"Section 1\"") && level(line) == 2), "the scroll-only wrapper takes no logical depth:\n{tree}");
    assert!(!shown.iter().any(|line| line.trim_start().starts_with("- group [ref=")), "the wrapper is not rendered:\n{tree}");
    assert!(!tree.contains("actions="), "actions are off by default");
    assert!(!tree.contains("Row 1.1.1"), "rows sit below the skeleton");
    assert_eq!(default.cuts.len(), 20, "each list is a cut");
    assert!(default.cuts.iter().all(|cut| cut.child_count == 5));
    assert!(tree.ends_with("(skeleton depth 3); complete"), "{tree}");
    let tokens = tree.chars().count().div_ceil(4);
    assert!(tokens <= 2_000, "the default read is {tokens} tokens");

    let with_actions = run(&mut refs, &mut fake, json!({"target": "101", "actions": true})).tree.expect("tree");
    assert!(with_actions.contains("- group \"Section 1\"") && with_actions.contains("actions=[press]"), "{with_actions}");

    let full = run(&mut refs, &mut fake, json!({"target": "101", "skeleton": false})).tree.expect("tree");
    assert!(full.contains("- button \"Open row 3.2.4\""), "the full tree per call");
    assert_eq!(lines(&full).iter().map(|line| level(line)).max(), Some(5));
    assert!(!full.contains("(skeleton"));
}

#[test]
fn find_searches_the_whole_snapshot_not_only_the_rendered_lines() {
    let mut fake = fixture(SKELETON);
    let mut refs = RefRegistry::default();
    let observed = run(&mut refs, &mut fake, json!({"target": "101"}));
    let tree = observed.tree.expect("tree");
    let wanted = Criteria { role: Some("button".into()), text: Some("Open row 3.2.4".into()) };
    let found = find(&refs, "101", &wanted);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(!tree.contains(&found[0].reference), "the target is not a rendered line");
    assert_eq!(found[0].generation, observed.generation);
    let rows = find(&refs, "101", &Criteria { role: Some("row".into()), text: None });
    assert_eq!(rows.len(), 100, "every row of the snapshot, none of them rendered");
    // The ref acts without a drill.
    assert!(refs.resolve(&found[0].reference, true, &mut fake).is_ok());
    assert!(find(&refs, "nope", &wanted).is_empty());

    // Past the node budget a node is in an unopened cut: `find` cannot see it, `drill` can.
    let mut dense = fixture("v3-ax-partial-10000-at-50ms.json");
    let mut refs = RefRegistry::default();
    let partial = run(&mut refs, &mut dense, json!({"target": "101"}));
    let save = Criteria { role: Some("button".into()), text: Some("Save".into()) };
    assert!(find(&refs, "101", &save).is_empty(), "the walk stopped above it");
    let content = find(&refs, "101", &Criteria { role: Some("group".into()), text: Some("Content".into()) });
    assert!(partial.cuts.iter().any(|cut| cut.reference == content[0].reference));
    let drilled = drill(&mut refs, &mut dense, &content[0].reference, None, true).expect("drill");
    assert!(drilled.generation > partial.generation);
    assert!(drilled.tree.expect("tree").contains("- button \"Save\""));
    assert!(refs.resolve(&content[0].reference, true, &mut dense).is_ok(), "the parent generation stays valid");
}

#[test]
fn ax_partial_10000_at_50ms_flags_every_cut() {
    let mut dense = fixture("v3-ax-partial-10000-at-50ms.json");
    let mut refs = RefRegistry::default();
    let read = run(&mut refs, &mut dense, json!({"target": "101", "skeleton": false}));
    assert!(!read.complete);
    assert_eq!(read.nodes_observed, 2_000);
    let generation = refs.latest("101").expect("generation");
    let cut: Vec<String> = (0..generation.entries.len())
        .filter(|i| generation.entries[*i].left_out.is_some())
        .map(|i| generation.token(i))
        .collect();
    assert!(!cut.is_empty());
    for token in &cut {
        assert!(read.cuts.iter().any(|c| &c.reference == token), "{token} is flagged");
    }
    let left: u32 = read.cuts.iter().map(|c| c.child_count).sum();
    assert_eq!(left, 10_000 - 2_000, "every node not observed is under a flagged cut");
    assert!(read.tree.expect("tree").ends_with("; partial"));
}
