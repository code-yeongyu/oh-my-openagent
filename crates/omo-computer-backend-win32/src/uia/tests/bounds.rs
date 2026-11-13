//! The walk's bounds: 50 raw depth and 10,000 siblings per parent; a web wrapper node consumes raw
//! depth but not logical depth. Coordinate clicks on an element are admitted only for the
//! position-independent roles.

use crate::uia::bounds::{coordinate_click_allowed, Walk, MAX_RAW_DEPTH, MAX_SIBLINGS};

#[test]
fn the_walk_stops_at_50_raw_depth_and_10000_siblings() {
    assert_eq!((MAX_RAW_DEPTH, MAX_SIBLINGS), (50, 10_000));
    let mut walk = Walk::default();
    for _ in 0..MAX_RAW_DEPTH {
        assert!(walk.descend(false), "within the bound");
    }
    assert!(!walk.descend(false), "the 51st raw level is cut");
    assert!(Walk::default().sibling_allowed(MAX_SIBLINGS - 1));
    assert!(
        !Walk::default().sibling_allowed(MAX_SIBLINGS),
        "the 10,001st sibling is cut"
    );
}

#[test]
fn web_wrappers_consume_raw_but_not_logical_depth() {
    let mut walk = Walk::default();
    assert!(walk.descend(true));
    assert!(walk.descend(false));
    assert_eq!((walk.raw(), walk.logical()), (2, 1));
}

#[test]
fn coordinate_clicks_only_for_position_independent_roles() {
    for role in [
        "Button",
        "MenuItem",
        "Hyperlink",
        "CheckBox",
        "RadioButton",
        "TabItem",
    ] {
        assert!(coordinate_click_allowed(role), "{role}");
    }
    for role in ["Edit", "Document", "Slider", "ListItem", "Text"] {
        assert!(!coordinate_click_allowed(role), "{role}");
    }
}
