use std::collections::HashMap;

use super::*;
use crate::error::{CoreResult, DesktopError};
use crate::types::{AxQuery, AxSnapshotOptions, DesktopWindow};

struct Mock {
    props: HashMap<u64, AxProps>,
    children: HashMap<u64, Vec<u64>>,
}
impl AxBackend for Mock {
    fn window_root(&mut self, _: &DesktopWindow) -> CoreResult<AxHandle> {
        Ok(AxHandle::Id(1))
    }

    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps> {
        let AxHandle::Id(id) = h else { unreachable!() };
        self.props
            .get(id)
            .cloned()
            .ok_or_else(|| DesktopError::ax_failed(format!("unreadable test node {id}")))
    }

    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        let AxHandle::Id(id) = h else { unreachable!() };
        Ok(self
            .children
            .get(id)
            .into_iter()
            .flatten()
            .map(|id| AxHandle::Id(*id))
            .collect())
    }

    fn parent(&mut self, _: &AxHandle) -> CoreResult<Option<AxHandle>> {
        Ok(None)
    }

    fn perform(&mut self, _: &AxHandle, _: &str) -> CoreResult<()> {
        Ok(())
    }

    fn set_value(&mut self, _: &AxHandle, _: &str) -> CoreResult<()> {
        Ok(())
    }

    fn focus(&mut self, _: &AxHandle) -> CoreResult<()> {
        Ok(())
    }

    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>> {
        Ok(self.props.iter().find_map(|(id, props)| {
            props
                .bounds
                .filter(|bounds| {
                    x >= bounds.x
                        && x < bounds.x + bounds.width
                        && y >= bounds.y
                        && y < bounds.y + bounds.height
                })
                .map(|_| AxHandle::Id(*id))
        }))
    }

    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>> {
        Ok(None)
    }

    fn attributes(&mut self, _: &AxHandle) -> CoreResult<Vec<(String, String)>> {
        Ok(Vec::new())
    }
}
fn p(role: &str, title: Option<&str>) -> AxProps {
    AxProps {
        role: role.into(),
        native_role: role.into(),
        title: title.map(str::to_string),
        value: None,
        description: None,
        enabled: true,
        focused: false,
        bounds: None,
        actions: Vec::new(),
        child_count: 0,
    }
}
fn window() -> DesktopWindow {
    DesktopWindow {
        identity: None,
        id: "7".into(),
        title: "Title".into(),
        app: "Safari".into(),
        pid: None,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        focused: true,
        is_on_screen: None,
        elevated: None,
    }
}
#[test]
fn snapshot_text_and_filter_are_exact() {
    let mut m = Mock {
        props: [
            (1, p("window", Some("Title"))),
            (2, p("group", None)),
            (3, p("button", Some("Go"))),
        ]
        .into(),
        children: [(1, vec![2]), (2, vec![3])].into(),
    };
    m.props.get_mut(&3).unwrap().actions.push("press".into());
    let s = snapshot(
        &mut m,
        &mut AxRegistry::default(),
        &window(),
        &AxSnapshotOptions::default(),
    )
    .unwrap();
    assert_eq!(
        s.text,
        "- window \"Title\" [ref=e1] app=Safari (focused)\n  - button \"Go\" [ref=e2]"
    );
    assert_eq!(s.node_count, 2);
}
#[test]
fn description_labels_unnamed_controls_without_changing_raw_title() {
    let mut reload = p("button", None);
    reload.description = Some("Reload".into());
    reload.actions.push("press".into());
    let mut m = Mock {
        props: [(1, p("window", Some("Title"))), (2, reload)].into(),
        children: [(1, vec![2])].into(),
    };
    let snapshot = snapshot(
        &mut m,
        &mut AxRegistry::default(),
        &window(),
        &AxSnapshotOptions::default(),
    )
    .unwrap();
    assert!(snapshot.text.contains("- button \"Reload\""));

    let q = AxQuery {
        role: Some("button".into()),
        title: Some("reload".into()),
        value: None,
        limit: None,
    };
    let nodes = query(&mut m, &mut AxRegistry::default(), &window(), &q).unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].title, None);
    assert_eq!(nodes[0].description.as_deref(), Some("Reload"));
}
#[test]
fn truncation_sets_flag_and_trailer() {
    let mut m = Mock {
        props: [(1, p("window", Some("Title"))), (2, p("button", Some("A")))].into(),
        children: [(1, vec![2])].into(),
    };
    let options = AxSnapshotOptions {
        max_nodes: Some(1),
        ..Default::default()
    };
    let s = snapshot(&mut m, &mut AxRegistry::default(), &window(), &options).unwrap();
    assert!(s.truncated);
    assert!(s.text.ends_with("… truncated (1 nodes)"));
}
#[test]
fn unreadable_subtree_is_skipped_with_trailer() {
    let mut m = Mock {
        props: [(1, p("window", Some("Title"))), (3, p("button", Some("Ready")))].into(),
        children: [(1, vec![2, 3])].into(),
    };
    let s = snapshot(
        &mut m,
        &mut AxRegistry::default(),
        &window(),
        &AxSnapshotOptions::default(),
    )
    .unwrap();
    assert_eq!(
        s.text,
        "- window \"Title\" [ref=e1] app=Safari (focused)\n  - button \"Ready\" [ref=e2]\n… \
         skipped 1 unreadable nodes"
    );
    assert_eq!(s.node_count, 2);
    let options = AxSnapshotOptions {
        max_nodes: Some(2),
        ..Default::default()
    };
    let limited = snapshot(&mut m, &mut AxRegistry::default(), &window(), &options).unwrap();
    assert!(limited.truncated);
    assert!(limited
        .text
        .ends_with("… truncated (2 nodes)\n… skipped 1 unreadable nodes"));
    let q = AxQuery {
        role: Some("button".into()),
        title: None,
        value: None,
        limit: None,
    };
    let nodes = query(&mut m, &mut AxRegistry::default(), &window(), &q).unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].title.as_deref(), Some("Ready"));
}
#[test]
fn bounds_center_hit_test_is_global_and_frameless() {
    let bounds = AxBounds {
        x: -420.0,
        y: 75.0,
        width: 80.0,
        height: 50.0,
    };
    let mut hit = p("button", Some("Global"));
    hit.bounds = Some(bounds);
    let mut m = Mock {
        props: [(1, p("window", Some("Title"))), (2, hit)].into(),
        children: HashMap::new(),
    };
    let mut registry = AxRegistry::default();
    let (x, y) = (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0);
    let node = element_at_node(&mut m, &mut registry, "desktop", x, y)
        .unwrap()
        .unwrap();
    assert_eq!(node.ref_, "e1");
    assert_eq!(
        (node.x, node.y, node.width, node.height),
        (Some(-420.0), Some(75.0), Some(80.0), Some(50.0))
    );
    assert!(matches!(registry.resolve("e1").unwrap(), AxHandle::Id(2)));
}

fn clamped_tree() -> Mock {
    let mut m = Mock {
        props: [
            (1, p("window", Some("Title"))),
            (2, p("group", None)),
            (3, p("button", Some("Go"))),
        ]
        .into(),
        children: [(1, vec![2]), (2, vec![3])].into(),
    };
    m.props.get_mut(&2).unwrap().child_count = 1;
    m
}

#[test]
fn an_object_mode_depth_clamp_keeps_the_node_and_counts_its_children() {
    // Given: depth 1 stops above the button.
    let mut registry = AxRegistry::with_report_mode(crate::report::ReportMode::Object);
    let options = AxSnapshotOptions {
        max_depth: Some(1),
        ..AxSnapshotOptions::default()
    };
    // A menu action keeps the group off the web-wrapper rule.
    let mut tree = clamped_tree();
    tree.props.get_mut(&2).unwrap().actions.push("AXShowMenu".into());
    // When
    let s = snapshot(&mut tree, &mut registry, &window(), &options).unwrap();
    // Then: the group stays as the cut, rendered with its count.
    assert_eq!((s.complete, s.truncated, s.nodes_observed), (Some(false), true, Some(2)));
    assert_eq!(s.cuts.len(), 1);
    assert_eq!(s.cuts[0].child_count, 1);
    assert!(s.text.contains(&format!("- group [ref={}] [... 1 more]", s.cuts[0].ref_)), "{}", s.text);
    assert!(registry.subtree_truncated(&s.cuts[0].ref_));
}

#[test]
fn a_cut_under_an_anonymous_non_structural_parent_stays_listed() {
    // Given: window -> splitgroup -> group with three buttons; four nodes
    // stop the walk inside the group, under a parent role the filter drops.
    let mut m = Mock {
        props: [
            (1, p("window", Some("Title"))),
            (2, p("splitgroup", None)),
            (3, p("group", None)),
            (4, p("button", Some("A"))),
            (5, p("button", Some("B"))),
            (6, p("button", Some("C"))),
        ]
        .into(),
        children: [(1, vec![2]), (2, vec![3]), (3, vec![4, 5, 6])].into(),
    };
    let mut registry = AxRegistry::with_report_mode(crate::report::ReportMode::Object);
    let options = AxSnapshotOptions {
        max_nodes: Some(4),
        ..AxSnapshotOptions::default()
    };
    // When
    let s = snapshot(&mut m, &mut registry, &window(), &options).unwrap();
    // Then: the group is still the listed, marked cut with its two buttons.
    assert_eq!((s.complete, s.truncated, s.nodes_observed), (Some(false), true, Some(4)));
    assert_eq!(s.cuts.len(), 1, "{}", s.text);
    assert_eq!(s.cuts[0].child_count, 2);
    assert!(s.text.contains(&format!("- group [ref={}] [... 2 more]", s.cuts[0].ref_)), "{}", s.text);
    assert!(s.text.contains("- button \"A\""), "{}", s.text);
    assert!(registry.subtree_truncated(&s.cuts[0].ref_));
}

#[test]
fn a_null_mode_depth_clamp_keeps_todays_reply() {
    // Given / When
    let options = AxSnapshotOptions {
        max_depth: Some(1),
        ..AxSnapshotOptions::default()
    };
    let s = snapshot(&mut clamped_tree(), &mut AxRegistry::default(), &window(), &options).unwrap();
    // Then: no partial members, no cut marker, the empty group filtered out.
    assert_eq!((s.complete, s.nodes_observed, s.cuts.len()), (None, None, 0));
    assert!(s.truncated);
    assert_eq!(s.text, "- window \"Title\" [ref=e1] app=Safari (focused)\n… truncated (2 nodes)");
}

/// `parents` lists (node, children); every node gets `child_count` from it.
fn tree(nodes: &[(u64, AxProps)], parents: &[(u64, Vec<u64>)]) -> Mock {
    let mut m = Mock {
        props: nodes.iter().cloned().collect(),
        children: parents.iter().cloned().collect(),
    };
    for (id, children) in parents {
        m.props.get_mut(id).unwrap().child_count = u32::try_from(children.len()).unwrap();
    }
    m
}

fn pressable(title: &str) -> AxProps {
    let mut button = p("button", Some(title));
    button.actions.push("press".into());
    button
}

fn object_registry() -> AxRegistry {
    AxRegistry::with_report_mode(crate::report::ReportMode::Object)
}

/// window(1) > 12 anonymous groups (2..=13) > button "Go"(14).
fn wrapper_chain() -> Mock {
    let mut nodes = vec![(1, p("window", Some("Title"))), (14, pressable("Go"))];
    let mut parents = vec![(1, vec![2])];
    for id in 2..=13 {
        let mut group = p("group", None);
        group.actions.push("AXScrollToVisible".into());
        nodes.push((id, group));
        parents.push((id, vec![id + 1]));
    }
    tree(&nodes, &parents)
}

#[test]
fn a_wrapper_chain_of_twelve_anonymous_groups_consumes_no_logical_depth() {
    // Given: a logical depth of 1 below the window.
    let options = AxSnapshotOptions {
        max_depth: Some(1),
        ..AxSnapshotOptions::default()
    };
    // When
    let object = snapshot(&mut wrapper_chain(), &mut object_registry(), &window(), &options).unwrap();
    let null = snapshot(&mut wrapper_chain(), &mut AxRegistry::default(), &window(), &options).unwrap();
    // Then: the object walk reaches the button through all 12 wrappers; null mode keeps today's raw cut.
    assert_eq!((object.complete, object.nodes_observed, object.cuts.len()), (Some(true), Some(14), 0));
    assert_eq!(
        object.text,
        "- window \"Title\" [ref=e1] app=Safari (focused)\n  - button \"Go\" [ref=e2]"
    );
    assert_eq!(
        null.text,
        "- window \"Title\" [ref=e1] app=Safari (focused)\n  - group [ref=e2]\n… truncated (2 nodes)"
    );
}

/// window(1) > "A"(2) > "B"(3) > "C"(4) > buttons "x"(5), "y"(6).
fn titled_levels() -> Mock {
    tree(
        &[
            (1, p("window", Some("Title"))),
            (2, p("group", Some("A"))),
            (3, p("group", Some("B"))),
            (4, p("group", Some("C"))),
            (5, pressable("x")),
            (6, pressable("y")),
        ],
        &[(1, vec![2]), (2, vec![3]), (3, vec![4]), (4, vec![5, 6])],
    )
}

fn skeleton() -> AxSnapshotOptions {
    AxSnapshotOptions {
        skeleton: Some(true),
        ..AxSnapshotOptions::default()
    }
}

#[test]
fn skeleton_clamps_logical_depth_to_three_and_counts_the_cut_children() {
    // Given / When
    let mut registry = object_registry();
    let s = snapshot(&mut titled_levels(), &mut registry, &window(), &skeleton()).unwrap();
    let shallower = AxSnapshotOptions {
        max_depth: Some(2),
        ..skeleton()
    };
    let two = snapshot(&mut titled_levels(), &mut object_registry(), &window(), &shallower).unwrap();
    // Then: "C" sits at logical depth 3 and carries its two children as the cut.
    assert_eq!(
        s.text,
        "- window \"Title\" [ref=e1] app=Safari (focused)\n  - group \"A\" [ref=e2]\n    - group \"B\" \
         [ref=e3]\n      - group \"C\" [ref=e4] [... 2 more]\n… truncated (4 nodes)"
    );
    assert_eq!((s.complete, s.generation, s.parent), (Some(false), Some(1), None));
    assert_eq!((s.cuts[0].ref_.as_str(), s.cuts[0].child_count), ("e4", 2));
    assert_eq!((two.cuts[0].ref_.as_str(), two.cuts[0].child_count), ("e3", 1));
}

#[test]
fn a_drill_reads_one_subtree_in_a_sub_generation_and_keeps_parent_refs() {
    // Given: a skeleton cut at "C" (e4).
    let mut m = titled_levels();
    let mut registry = object_registry();
    let first = snapshot(&mut m, &mut registry, &window(), &skeleton()).unwrap();
    // When
    let options = AxSnapshotOptions {
        root: Some("e4".into()),
        ..AxSnapshotOptions::default()
    };
    let drill = snapshot(&mut m, &mut registry, &window(), &options).unwrap();
    // Then
    assert_eq!((drill.generation, drill.parent), (Some(2), first.generation));
    assert_eq!(
        drill.text,
        "- group \"C\" [ref=e5]\n  - button \"x\" [ref=e6]\n  - button \"y\" [ref=e7]"
    );
    assert_eq!(drill.complete, Some(true));
    for reference in ["e1", "e2", "e3", "e4", "e6"] {
        assert!(registry.resolve(reference).is_ok(), "{reference}");
    }
    assert!(matches!(registry.resolve("e2").unwrap(), AxHandle::Id(2)));
}

#[test]
fn a_drill_on_a_stale_ref_fails_stale_ref_and_starts_no_generation() {
    // Given: e1 aged out by eight newer snapshots.
    let mut m = titled_levels();
    let mut registry = object_registry();
    for _ in 0..9 {
        snapshot(&mut m, &mut registry, &window(), &skeleton()).unwrap();
    }
    let options = AxSnapshotOptions {
        root: Some("e1".into()),
        ..AxSnapshotOptions::default()
    };
    // When
    let error = snapshot(&mut m, &mut registry, &window(), &options).err().map(|error| error.code);
    // Then
    assert_eq!(error, Some(crate::error::ErrorCode::StaleRef));
    assert_eq!(registry.current_generation("7"), 9);
}

#[test]
fn a_drill_on_a_ref_of_another_window_is_an_invalid_target() {
    // Given
    let mut m = titled_levels();
    let mut registry = object_registry();
    snapshot(&mut m, &mut registry, &window(), &skeleton()).unwrap();
    let other = DesktopWindow {
        id: "8".into(),
        ..window()
    };
    let options = AxSnapshotOptions {
        root: Some("e2".into()),
        ..AxSnapshotOptions::default()
    };
    // When
    let error = snapshot(&mut m, &mut registry, &other, &options).err().map(|error| error.code);
    // Then
    assert_eq!(error, Some(crate::error::ErrorCode::InvalidTarget));
}

#[test]
fn null_mode_ignores_skeleton_and_root_and_fills_no_generation() {
    // Given: two null-mode registries that each read the window once.
    let second = |options: &AxSnapshotOptions| {
        let mut registry = AxRegistry::default();
        snapshot(&mut titled_levels(), &mut registry, &window(), &AxSnapshotOptions::default()).unwrap();
        snapshot(&mut titled_levels(), &mut registry, &window(), options).unwrap()
    };
    let options = AxSnapshotOptions {
        root: Some("e4".into()),
        ..skeleton()
    };
    // When
    let plain = second(&AxSnapshotOptions::default());
    let ignored = second(&options);
    // Then
    assert_eq!(ignored, plain);
    assert_eq!((ignored.generation, ignored.parent, ignored.complete), (None, None, None));
}
