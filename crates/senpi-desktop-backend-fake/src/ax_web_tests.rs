//! Skeleton observation and drill-down over the dense web scenario
//! (`fixtures/v2-ax-web.json`): a browser window whose page nests its
//! controls under anonymous wrapper chains.

use std::collections::{BTreeSet, VecDeque};

use senpi_desktop_core::ax::{self, AxBackend, AxHandle, AxRegistry};
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::types::{AxSnapshot, AxSnapshotOptions, DesktopWindow};

use crate::{FakeBackend, FakeScenario};

/// The observe text budget, in tokens, and the chars-per-token proxy used to
/// measure it.
const TOKEN_BUDGET: usize = 2_000;
const CHARS_PER_TOKEN: usize = 4;

fn web() -> FakeBackend {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/v2-ax-web.json");
    FakeBackend::new(FakeScenario::load(std::path::Path::new(path)).expect("v2-ax-web parses"))
}

fn window() -> DesktopWindow {
    DesktopWindow {
        identity: None,
        id: "101".into(),
        title: "Docs - Browser".into(),
        app: "Browser".into(),
        pid: Some(4343),
        x: 100,
        y: 120,
        width: 1200,
        height: 900,
        focused: true,
        is_on_screen: None,
        elevated: None,
    }
}

fn skeleton(root: Option<String>) -> AxSnapshotOptions {
    AxSnapshotOptions {
        skeleton: Some(true),
        root,
        ..AxSnapshotOptions::default()
    }
}

fn tokens(snapshot: &AxSnapshot) -> usize {
    snapshot.text.chars().count().div_ceil(CHARS_PER_TOKEN)
}

fn refs(text: &str) -> Vec<String> {
    text.split("[ref=")
        .skip(1)
        .filter_map(|rest| rest.split(']').next())
        .map(str::to_owned)
        .collect()
}

/// Ids of every node the snapshot filter keeps as a control.
fn interactive_ids(fake: &mut FakeBackend) -> BTreeSet<u64> {
    let mut ids = BTreeSet::new();
    let mut stack = vec![fake.window_root(&window()).expect("root")];
    while let Some(handle) = stack.pop() {
        let props = fake.props(&handle).expect("props");
        if !props.actions.is_empty() || matches!(props.role.as_str(), "button" | "link" | "textfield") {
            let AxHandle::Id(id) = handle else { unreachable!() };
            ids.insert(id);
        }
        stack.extend(fake.children(&handle).expect("children"));
    }
    ids
}

#[test]
fn a_skeleton_of_the_dense_web_page_fits_the_token_budget() {
    // Given
    let mut fake = web();
    // When
    let full = ax::snapshot(
        &mut fake,
        &mut AxRegistry::with_report_mode(ReportMode::Object),
        &window(),
        &AxSnapshotOptions::default(),
    )
    .expect("full snapshot");
    let skeleton = ax::snapshot(
        &mut fake,
        &mut AxRegistry::with_report_mode(ReportMode::Object),
        &window(),
        &skeleton(None),
    )
    .expect("skeleton snapshot");
    // Then: the full tree is over budget, the skeleton is not.
    assert!(tokens(&full) > TOKEN_BUDGET, "full: {} tokens", tokens(&full));
    assert!(tokens(&skeleton) <= TOKEN_BUDGET, "skeleton: {} tokens", tokens(&skeleton));
    assert_eq!(skeleton.complete, Some(false));
    assert!(skeleton.cuts.iter().all(|cut| cut.child_count > 0));
    // The 12 wrappers under the web area cost no depth: the navigation links
    // (logical depth 3) are in the skeleton; the identified footer group is
    // not a wrapper, so the footer is a cut.
    assert!(skeleton.text.contains("- link \"Nav 40\""), "{}", skeleton.text);
    assert!(skeleton.text.contains("- group \"Footer\""), "{}", skeleton.text);
    assert!(!skeleton.text.contains("Footer 1\""), "{}", skeleton.text);
}

#[test]
fn every_interactive_node_is_reachable_by_drilling_the_skeleton_cuts() {
    // Given
    let mut fake = web();
    let expected = interactive_ids(&mut fake);
    let mut registry = AxRegistry::with_report_mode(ReportMode::Object);
    let first = ax::snapshot(&mut fake, &mut registry, &window(), &skeleton(None)).expect("skeleton");
    // When: drill every cut, breadth first, each drill a skeleton too.
    let mut seen = refs(&first.text);
    let mut pending: VecDeque<String> = first.cuts.iter().map(|cut| cut.ref_.clone()).collect();
    let mut drills = 0;
    while let Some(cut) = pending.pop_front() {
        let drill = ax::snapshot(&mut fake, &mut registry, &window(), &skeleton(Some(cut))).expect("drill");
        assert!(drill.parent.is_some() && drill.generation > drill.parent);
        seen.extend(refs(&drill.text));
        pending.extend(drill.cuts.iter().map(|cut| cut.ref_.clone()));
        drills += 1;
    }
    // Then: every ref ever handed out still resolves, and together they
    // cover every interactive node.
    let reached: BTreeSet<u64> = seen
        .iter()
        .map(|reference| match registry.resolve(reference).expect(reference) {
            AxHandle::Id(id) => id,
            AxHandle::Native(_) => unreachable!(),
        })
        .collect();
    assert!(drills > 0);
    let missing: Vec<_> = expected.difference(&reached).collect();
    assert!(missing.is_empty(), "unreached interactive nodes: {missing:?}");
}
