use std::collections::HashMap;

use senpi_desktop_core::ax::{AxBackend, AxBounds, AxHandle};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::types::DesktopWindow;

use super::actions::action_name;
use super::props::{read_props, truncate_chars, AttributeSource};
use super::tree::{bounds_matches_window, pick_by_title_and_frame};
use super::MacAx;

/// In-memory AX element: attribute name -> string or bool.
#[derive(Default)]
struct FakeElement {
    strings: HashMap<&'static str, &'static str>,
    booleans: HashMap<&'static str, bool>,
    bounds: Option<AxBounds>,
    actions: Vec<String>,
    children: u32,
}

impl FakeElement {
    fn with_role(role: &'static str) -> Self {
        Self {
            strings: HashMap::from([("AXRole", role)]),
            ..Self::default()
        }
    }
}

impl AttributeSource for FakeElement {
    fn required_string(&self, attribute: &str) -> CoreResult<String> {
        self.string(attribute)
            .ok_or_else(|| DesktopError::ax_failed(format!("copying {attribute} returned no value")))
    }

    fn string(&self, attribute: &str) -> Option<String> {
        self.strings.get(attribute).map(ToString::to_string)
    }

    fn value_string(&self, attribute: &str) -> Option<String> {
        self.string(attribute)
    }

    fn boolean(&self, attribute: &str) -> Option<bool> {
        self.booleans.get(attribute).copied()
    }

    fn bounds(&self) -> Option<AxBounds> {
        self.bounds
    }

    fn action_names(&self) -> Vec<String> {
        self.actions.clone()
    }

    fn child_count(&self) -> u32 {
        self.children
    }
}

fn window(title: &str) -> DesktopWindow {
    DesktopWindow {
        id: "42".to_string(),
        title: title.to_string(),
        app: "TextEdit".to_string(),
        pid: Some(7),
        x: 100,
        y: 50,
        width: 800,
        height: 600,
        focused: false,
        elevated: None,
    }
}

const fn bounds(x: f64, width: f64) -> AxBounds {
    AxBounds {
        x,
        y: 50.0,
        width,
        height: 600.0,
    }
}

#[test]
fn props_normalize_native_role_and_map_every_attribute() {
    let element = FakeElement {
        strings: HashMap::from([
            ("AXRole", "AXTextArea"),
            ("AXTitle", "Body"),
            ("AXValue", "hello"),
            ("AXDescription", "document text"),
        ]),
        booleans: HashMap::from([("AXEnabled", false), ("AXFocused", true)]),
        bounds: Some(bounds(1.0, 2.0)),
        actions: vec!["AXShowMenu".to_string()],
        children: 3,
    };
    let props = read_props(&element).unwrap();
    assert_eq!(props.role, "textarea");
    assert_eq!(props.native_role, "AXTextArea");
    assert_eq!(props.title.as_deref(), Some("Body"));
    assert_eq!(props.value.as_deref(), Some("hello"));
    assert_eq!(props.description.as_deref(), Some("document text"));
    assert!(!props.enabled);
    assert!(props.focused);
    assert_eq!(props.bounds, Some(bounds(1.0, 2.0)));
    assert_eq!(props.actions, ["AXShowMenu"]);
    assert_eq!(props.child_count, 3);
}

#[test]
fn props_default_enabled_unfocused_when_flags_are_absent() {
    let props = read_props(&FakeElement::with_role("AXButton")).unwrap();
    assert_eq!(props.role, "button");
    assert!(props.enabled);
    assert!(!props.focused);
}

#[test]
fn props_drop_empty_strings_when_attributes_are_blank() {
    let mut element = FakeElement::with_role("AXStaticText");
    element
        .strings
        .extend([("AXTitle", ""), ("AXValue", ""), ("AXDescription", "")]);
    let props = read_props(&element).unwrap();
    assert_eq!((props.title, props.value, props.description), (None, None, None));
}

#[test]
fn props_fail_when_role_is_missing() {
    let error = read_props(&FakeElement::default()).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn action_names_map_to_native_ax_actions() {
    for (action, native) in [
        ("press", "AXPress"),
        (" Press ", "AXPress"),
        ("raise", "AXRaise"),
        ("show_menu", "AXShowMenu"),
        ("showmenu", "AXShowMenu"),
        ("AXConfirm", "AXConfirm"),
        ("Increment", "AXIncrement"),
    ] {
        assert_eq!(action_name(action), native, "{action}");
    }
}

#[test]
fn window_frame_matches_within_two_points() {
    assert!(bounds_matches_window(bounds(102.0, 798.0), &window("Doc")));
    assert!(!bounds_matches_window(bounds(103.0, 800.0), &window("Doc")));
}

#[test]
fn title_and_frame_match_wins_over_an_earlier_title_only_match() {
    let candidates = [
        ("moved", "Doc".to_string(), Some(bounds(400.0, 800.0))),
        ("exact", "Doc".to_string(), Some(bounds(100.0, 800.0))),
    ];
    assert_eq!(pick_by_title_and_frame(candidates, &window("Doc")), Some("exact"));
}

#[test]
fn unique_title_matches_when_frames_differ() {
    let candidates = [
        ("other", "Notes".to_string(), None),
        ("doc", "Doc".to_string(), Some(bounds(400.0, 800.0))),
    ];
    assert_eq!(pick_by_title_and_frame(candidates, &window("Doc")), Some("doc"));
}

#[test]
fn ambiguous_title_without_frame_match_finds_nothing() {
    let candidates = [
        ("first", "Doc".to_string(), None),
        ("second", "Doc".to_string(), Some(bounds(400.0, 800.0))),
    ];
    assert_eq!(pick_by_title_and_frame(candidates, &window("Doc")), None);
}

#[test]
fn truncation_keeps_short_values_and_marks_long_ones() {
    assert_eq!(truncate_chars("abc".to_string(), 3), "abc");
    assert_eq!(truncate_chars("abcdef".to_string(), 4), "abc…");
}

#[test]
fn foreign_handles_are_rejected_with_ax_failed() {
    let error = MacAx::new().props(&AxHandle::Id(1)).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}
