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
        id: "7".into(),
        title: "Title".into(),
        app: "Safari".into(),
        pid: None,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        focused: true,
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
