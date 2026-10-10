//! The fake backend's menu tree: listing children along a path, and
//! selecting a leaf command through core's matching rules.

use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, SinkOp};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::menus::MenuItem;

const MENUS: &str = r#"{
    "windows": [
        { "id": "101", "title": "Editor", "app": "Code", "x": 0, "y": 0, "width": 800, "height": 600, "focused": true }
    ],
    "menus": {
        "101": [
            {
                "title": "File",
                "children": [
                    { "title": "Save", "shortcut": "Cmd+S" },
                    { "title": "Export…", "children": [{ "title": "PDF" }] }
                ]
            },
            { "title": "Edit", "enabled": false, "children": [{ "title": "Undo" }] },
            { "title": "" },
            { "title": "View", "checked": true }
        ]
    }
}"#;

fn backend(overlay: &str) -> FakeBackend {
    let mut json: serde_json::Value = serde_json::from_str(MENUS).expect("scenario is JSON");
    let overlay: serde_json::Value = serde_json::from_str(overlay).expect("overlay is JSON");
    for (key, value) in overlay.as_object().expect("overlay is an object") {
        json[key] = value.clone();
    }
    let scenario = FakeScenario::from_json(&json.to_string()).expect("scenario parses");
    FakeBackend::new(scenario)
}

fn window(backend: &mut FakeBackend) -> senpi_desktop_core::types::DesktopWindow {
    backend.windows().expect("windows").remove(0)
}

fn labels(path: &[&str]) -> Vec<String> {
    path.iter().map(|label| (*label).to_owned()).collect()
}

fn titles(items: &[MenuItem]) -> Vec<&str> {
    items.iter().map(|item| item.title.as_str()).collect()
}

#[test]
fn items_at_the_menu_bar_root_lists_the_top_level_titles() {
    // Given
    let mut backend = backend("{}");
    let window = window(&mut backend);
    // When
    let items = backend.menu_items(&window, &[]).expect("root items");
    // Then: the untitled separator stays invisible
    assert_eq!(titles(&items), ["File", "Edit", "View"]);
    assert!(items[0].has_submenu);
    assert!(!items[1].enabled);
    assert!(items[2].checked);
    assert_eq!(items[0].path, labels(&["File"]));
}

#[test]
fn items_at_a_nested_path_lists_that_submenus_children() {
    // Given
    let mut backend = backend("{}");
    let window = window(&mut backend);
    // When
    let items = backend.menu_items(&window, &labels(&["File"])).expect("File children");
    // Then
    assert_eq!(titles(&items), ["Save", "Export…"]);
    assert_eq!(items[0].shortcut.as_deref(), Some("Cmd+S"));
    assert!(!items[0].has_submenu);
    assert!(items[1].has_submenu);
    assert_eq!(items[1].path, labels(&["File", "Export…"]));
}

#[test]
fn selecting_an_exact_title_records_one_sink_op() {
    // Given
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    // When
    backend
        .menu_select(&window, &labels(&["File", "Save"]), &|| Ok(()))
        .expect("select succeeds");
    // Then
    assert_eq!(
        sink.ops(),
        [SinkOp::MenuSelect {
            window: "101".to_owned(),
            path: labels(&["File", "Save"]),
        }]
    );
}

#[test]
fn selecting_with_an_ellipsis_normalized_title_matches_the_native_label() {
    // Given
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    // When: "Export" and "Export..." both name "Export…"
    backend
        .menu_select(&window, &labels(&["File", "Export", "PDF"]), &|| Ok(()))
        .expect("select succeeds");
    // Then: the sink records the native path of the chosen item
    assert_eq!(
        sink.ops(),
        [SinkOp::MenuSelect {
            window: "101".to_owned(),
            path: labels(&["File", "Export…", "PDF"]),
        }]
    );
}

#[test]
fn an_ambiguous_label_is_refused_and_dispatches_nothing() {
    // Given: two titles that fold to the same lowercase; core's exact tier is
    // case-insensitive, so neither wins and the label is ambiguous
    let mut backend = backend(
        r#"{"menus": {"101": [
        { "title": "File", "children": [{ "title": "Save" }, { "title": "SAVE" }] }
    ]}}"#,
    );
    let sink = backend.sink();
    let window = window(&mut backend);
    // When
    let refused = backend
        .menu_select(&window, &labels(&["File", "save"]), &|| Ok(()))
        .expect_err("save names both Save and SAVE");
    // Then
    assert_eq!(refused.code, ErrorCode::AxFailed, "{refused}");
    assert!(refused.message.contains("ambiguous"), "{refused}");
    assert!(sink.ops().is_empty(), "{:?}", sink.ops());
}

#[test]
fn a_disabled_leaf_is_refused_and_dispatches_nothing() {
    // Given
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    // When
    let refused = backend
        .menu_select(&window, &labels(&["Edit", "Undo"]), &|| Ok(()))
        .expect_err("Undo lives under a disabled submenu");
    // Then: the walk already refuses at the disabled submenu
    assert_eq!(refused.code, ErrorCode::AxFailed, "{refused}");
    assert!(refused.message.contains("disabled"), "{refused}");
    assert!(sink.ops().is_empty(), "{:?}", sink.ops());
}

#[test]
fn a_disabled_submenu_in_the_path_is_refused_before_the_leaf() {
    // Given: File is disabled, so even the enabled Save under it is unreachable
    let mut backend = backend(
        r#"{"menus": {"101": [
        { "title": "File", "enabled": false, "children": [{ "title": "Save" }] }
    ]}}"#,
    );
    let sink = backend.sink();
    let window = window(&mut backend);
    // When
    let refused = backend
        .menu_select(&window, &labels(&["File", "Save"]), &|| Ok(()))
        .expect_err("the disabled submenu stops the walk");
    // Then
    assert_eq!(refused.code, ErrorCode::AxFailed, "{refused}");
    assert!(refused.message.contains("disabled"), "{refused}");
    assert!(sink.ops().is_empty(), "{:?}", sink.ops());
}

#[test]
fn a_submenu_as_the_leaf_is_not_a_command() {
    // Given
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    // When
    let refused = backend
        .menu_select(&window, &labels(&["File", "Export…"]), &|| Ok(()))
        .expect_err("Export… opens a submenu");
    // Then
    assert_eq!(refused.code, ErrorCode::AxFailed, "{refused}");
    assert!(sink.ops().is_empty(), "{:?}", sink.ops());
}

#[test]
fn an_invalid_path_is_refused_before_the_backend_walks() {
    // Given
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    // When: an empty label never reaches native matching
    let refused = backend
        .menu_select(&window, &labels(&["File", " "]), &|| Ok(()))
        .expect_err("a blank label is an invalid path");
    // Then
    assert_eq!(refused.code, ErrorCode::InvalidTarget, "{refused}");
    assert!(sink.ops().is_empty(), "{:?}", sink.ops());
}

#[test]
fn selecting_with_an_empty_path_is_invalid_but_listing_is_not() {
    // Given
    let mut backend = backend("{}");
    let window = window(&mut backend);
    // When / Then
    assert!(backend.menu_items(&window, &[]).is_ok());
    let refused = backend
        .menu_select(&window, &[], &|| Ok(()))
        .expect_err("an empty path names no command");
    assert_eq!(refused.code, ErrorCode::InvalidTarget, "{refused}");
}

#[test]
fn a_backend_without_menus_reports_ax_unsupported() {
    // Given: the scenario has the window but carries no menu tree for it
    let mut backend = backend(r#"{"menus": {}}"#);
    let window = window(&mut backend);
    // When / Then
    let items = backend.menu_items(&window, &[]).expect_err("no menus");
    assert_eq!(items.code, ErrorCode::AxUnsupported, "{items}");
    let select = backend
        .menu_select(&window, &labels(&["File", "Save"]), &|| Ok(()))
        .expect_err("no menus");
    assert_eq!(select.code, ErrorCode::AxUnsupported, "{select}");
}

#[test]
fn a_stop_landing_mid_walk_dispatches_nothing() {
    // Given: the stop lands once the walk has opened the first submenu
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    let levels = std::cell::Cell::new(0);
    let check_stop = || {
        levels.set(levels.get() + 1);
        if levels.get() > 1 {
            Err(senpi_desktop_core::error::DesktopError::new(
                ErrorCode::Suspended,
                "stop chord",
            ))
        } else {
            Ok(())
        }
    };
    // When
    let error = backend
        .menu_select(&window, &labels(&["File", "Export…", "PDF"]), &check_stop)
        .expect_err("a stop mid-walk refuses");
    // Then
    assert_eq!(error.code, ErrorCode::Suspended);
    assert_eq!(levels.get(), 2);
    assert_eq!(sink.ops(), []);
}

#[test]
fn the_stop_is_checked_again_right_before_the_press() {
    // Given: every level passes, and the stop lands only on the final check
    let mut backend = backend("{}");
    let sink = backend.sink();
    let window = window(&mut backend);
    let checks = std::cell::Cell::new(0);
    let check_stop = || {
        checks.set(checks.get() + 1);
        if checks.get() == 2 {
            Err(senpi_desktop_core::error::DesktopError::new(
                ErrorCode::Cancelled,
                "cancelled",
            ))
        } else {
            Ok(())
        }
    };
    // When: File > Save walks one level, then checks before the press
    let error = backend
        .menu_select(&window, &labels(&["File", "Save"]), &check_stop)
        .expect_err("a stop before the press refuses");
    // Then
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(sink.ops(), []);
}
