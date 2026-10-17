use super::*;
use crate::error::ErrorCode;

fn display(id: &str, x: i32, y: i32, primary: bool) -> DesktopDisplay {
    DesktopDisplay {
        id: id.into(),
        name: id.into(),
        x,
        y,
        width: 100,
        height: 100,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: 100,
        pixel_height: 100,
        is_primary: primary,
    }
}

fn window(x: i32, y: i32, width: u32, height: u32) -> DesktopWindow {
    DesktopWindow {
        id: "window".into(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x,
        y,
        width,
        height,
        focused: true,
        is_on_screen: None,
        elevated: None,
    }
}

#[test]
fn active_selects_largest_intersection_at_negative_coordinates() {
    let displays = vec![
        display("primary", 0, 0, true),
        display("left", -100, -100, false),
    ];
    let focused = window(-80, -80, 100, 100);
    let selected = DisplaySelector::parse(None)
        .select(displays, Some(&focused))
        .unwrap();
    assert_eq!(selected[0].id, "left");
    assert_eq!(selected.len(), 1);
}

#[test]
fn active_falls_back_to_primary_without_focus_or_intersection() {
    let displays = vec![
        display("left", -100, 0, false),
        display("primary", 0, 0, true),
    ];
    for focused in [None, Some(window(1000, 1000, 10, 10))] {
        let selected = DisplaySelector::parse(None)
            .select(displays.clone(), focused.as_ref())
            .unwrap();
        assert_eq!(selected[0].id, "primary");
    }
}

#[test]
fn tied_nonprimary_intersections_fall_back_to_primary() {
    let displays = vec![
        display("left", -100, 0, false),
        display("right", 0, 0, false),
        display("primary", 1000, 0, true),
    ];
    let focused = window(-50, 0, 100, 100);
    let selected = DisplaySelector::parse(None)
        .select(displays, Some(&focused))
        .unwrap();
    assert_eq!(selected[0].id, "primary");
}

#[test]
fn unset_empty_and_active_select_one_but_all_and_ids_are_preserved() {
    let displays = vec![
        display("primary", 0, 0, true),
        display("other", 100, 0, false),
    ];
    for raw in [None, Some(""), Some(" active "), Some("ACTIVE")] {
        let selected = DisplaySelector::parse(raw.map(str::to_owned))
            .select(displays.clone(), None)
            .unwrap();
        assert_eq!(selected[0].id, "primary");
        assert_eq!(selected.len(), 1);
    }
    assert_eq!(
        DisplaySelector::parse(Some("all".into()))
            .select(displays.clone(), None)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        DisplaySelector::parse(Some("other".into()))
            .select(displays, None)
            .unwrap()[0]
            .id,
        "other"
    );
}

#[test]
fn empty_displays_and_unknown_ids_use_existing_errors() {
    assert_eq!(
        DisplaySelector::parse(None)
            .select(vec![], None)
            .unwrap_err()
            .code,
        ErrorCode::CaptureFailed
    );
    assert_eq!(
        DisplaySelector::Id("missing".into())
            .select(vec![display("primary", 0, 0, true)], None)
            .unwrap_err()
            .code,
        ErrorCode::InvalidTarget,
    );
}

#[test]
fn display_target_keys_are_separate_from_desktop_and_window_keys() {
    let target = Target::parse("display:other");
    assert!(matches!(target, Target::Display(_)));
    assert_eq!(
        target.display_selector(),
        Some(DisplaySelector::Id("other".into()))
    );
    assert_eq!(Target::parse("display:ACTIVE").key(), "display:active");
    assert_eq!(
        Target::parse("display:all").display_selector(),
        Some(DisplaySelector::All)
    );
    assert_ne!(target, Target::parse("other"));
    assert_ne!(target.key(), Target::Desktop.key());
    assert_eq!(target.key(), "display:other");
}
