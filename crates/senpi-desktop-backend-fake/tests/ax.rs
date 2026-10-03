mod common;

use senpi_desktop_backend_fake::{FakeBackend, FakeMethod, FakeScenario, SinkOp};
use senpi_desktop_core::ax::{self, AxHandle, AxRegistry};
use senpi_desktop_core::backend::{AxBackend, Backend};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{AxQuery, AxSnapshotOptions, DesktopWindow};

fn fixture_window(backend: &mut FakeBackend) -> DesktopWindow {
    backend.windows().expect("windows").remove(0)
}

fn save_button(backend: &mut FakeBackend) -> AxHandle {
    backend
        .element_at(840.0, 690.0)
        .expect("hit test")
        .expect("save button")
}

#[test]
fn snapshot_renders_the_scripted_tree_through_core() {
    // Given
    let mut backend = common::fixture_backend();
    let window = fixture_window(&mut backend);
    let mut registry = AxRegistry::default();
    // When
    let snapshot = ax::snapshot(
        &mut backend,
        &mut registry,
        &window,
        &AxSnapshotOptions::default(),
    )
    .expect("snapshot");
    // Then
    assert_eq!(snapshot.node_count, 3);
    assert!(snapshot.text.contains("Save"), "{}", snapshot.text);
}

#[test]
fn query_finds_the_button_by_role_and_title() {
    let mut backend = common::fixture_backend();
    let window = fixture_window(&mut backend);
    let query = AxQuery {
        role: Some("button".into()),
        title: Some("save".into()),
        ..AxQuery::default()
    };
    let nodes = ax::query(&mut backend, &mut AxRegistry::default(), &window, &query).expect("query");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].title.as_deref(), Some("Save"));
}

#[test]
fn element_at_returns_the_deepest_node_and_parent_walks_up() {
    let mut backend = common::fixture_backend();
    let button = save_button(&mut backend);
    assert_eq!(backend.props(&button).expect("props").role, "button");
    let parent = backend.parent(&button).expect("parent").expect("window root");
    assert_eq!(backend.props(&parent).expect("props").role, "window");
    assert!(backend.element_at(5.0, 5.0).expect("hit test").is_none());
}

#[test]
fn perform_records_supported_actions_and_rejects_others() {
    let mut backend = common::fixture_backend();
    let button = save_button(&mut backend);
    let AxHandle::Id(node) = button else {
        panic!("fake handles are ids")
    };
    ax::ax_press(&mut backend, &button).expect("press");
    let err = backend.perform(&button, "showMenu").expect_err("unsupported");
    assert_eq!(err.code, ErrorCode::AxFailed);
    assert_eq!(
        backend.sink().ops(),
        vec![SinkOp::AxPerform {
            node,
            action: "press".into()
        }]
    );
}

#[test]
fn set_value_and_focus_update_the_tree() {
    let mut backend = common::fixture_backend();
    let text = backend.focused_element().expect("focused").expect("textarea");
    backend.set_value(&text, "hello").expect("set value");
    assert_eq!(
        backend.props(&text).expect("props").value.as_deref(),
        Some("hello")
    );
    let button = save_button(&mut backend);
    backend.focus(&button).expect("focus");
    let focused = backend.focused_element().expect("focused").expect("button");
    assert_eq!(backend.props(&focused).expect("props").role, "button");
    assert!(!backend.props(&text).expect("props").focused);
}

#[test]
fn attributes_list_the_present_props() {
    let mut backend = common::fixture_backend();
    let button = save_button(&mut backend);
    let attributes = backend.attributes(&button).expect("attributes");
    assert!(attributes.contains(&("title".into(), "Save".into())));
    assert!(attributes.contains(&("nativeRole".into(), "AXButton".into())));
    assert!(!attributes.iter().any(|(name, _)| name == "value"));
}

#[test]
fn ax_unavailable_scenario_hides_the_ax_backend() {
    let json = r#"{"capabilities":{"ax":false}}"#;
    let mut backend = FakeBackend::new(FakeScenario::from_json(json).expect("parses"));
    assert!(backend.ax().is_none());
}

#[test]
fn window_without_a_scripted_tree_is_ax_failed() {
    let mut scenario = common::fixture_scenario();
    scenario.ax.clear();
    let mut backend = FakeBackend::new(scenario);
    let window = fixture_window(&mut backend);
    let Err(err) = backend.window_root(&window) else {
        panic!("no tree scripted")
    };
    assert_eq!(err.code, ErrorCode::AxFailed);
}

#[test]
fn ax_methods_honor_injected_failures() {
    let mut backend = common::fixture_backend();
    backend.fail_next(FakeMethod::AxElementAt, ErrorCode::StaleRef);
    let Err(err) = backend.element_at(840.0, 690.0) else {
        panic!("injected")
    };
    assert_eq!(err.code, ErrorCode::StaleRef);
}
