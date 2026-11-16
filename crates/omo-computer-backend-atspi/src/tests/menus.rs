//! Menus: the tree read without acting, selection by exact label, an ambiguous path that
//! presses nothing, and a refused path that closes every menu its walk opened.

use omo_computer_core::backend::Delivered;
use omo_computer_core::error::EngineCode;

use super::{gedit, Fixture, GEDIT_XID};
use crate::bus::NodeId;

/// gedit's File menu holding `items`, each pressable unless named in `inert`.
fn file_menu(items: &[&str], inert: &[&str]) -> (Fixture, NodeId, NodeId) {
    let mut fx = gedit();
    let bar = fx.bus.node(&fx.frame, "menu bar", "");
    let file = fx.bus.node(&bar, "menu", "File");
    fx.bus.set_actions(&file, &["click"]);
    for label in items {
        let item = fx.bus.node(&file, "menu item", label);
        if !inert.contains(label) {
            fx.bus.set_actions(&item, &["click"]);
        }
    }
    (fx, bar, file)
}

#[test]
fn a_menu_item_is_selected_by_its_exact_label() {
    let mut fx = gedit();
    let bar = fx.bus.node(&fx.frame, "menu bar", "");
    let file = fx.bus.node(&bar, "menu", "File");
    fx.bus.set_actions(&file, &["click"]);
    let close = fx.bus.node(&file, "menu item", "Close");
    fx.bus.set_actions(&close, &["click"]);
    let close_all = fx.bus.node(&file, "menu item", "Close All");
    fx.bus.set_actions(&close_all, &["click"]);
    let (mut backend, handle) = fx.backend();

    let delivered = backend
        .select_menu(GEDIT_XID, &["File", "Close"])
        .expect("select");
    let missing = backend
        .select_menu(GEDIT_XID, &["File", "Clos"])
        .expect_err("labels are exact");

    assert_eq!(delivered, Delivered { count: 1, of: 1 });
    assert_eq!(
        handle.performed(),
        vec![(file.clone(), 0), (close, 0), (file, 0)]
    );
    assert_eq!(
        missing.code(),
        EngineCode::StaleRef,
        "a step naming no item is stale"
    );
}

#[test]
fn the_menu_tree_is_read_without_acting_and_twin_labels_are_ambiguous() {
    let mut fx = gedit();
    let bar = fx.bus.node(&fx.frame, "menu bar", "");
    let file = fx.bus.node(&bar, "menu", "File");
    fx.bus.set_actions(&file, &["click"]);
    for _ in 0..2 {
        let twin = fx.bus.node(&file, "menu item", "Export");
        fx.bus.set_actions(&twin, &["click"]);
    }
    let (mut backend, handle) = fx.backend();

    let tree = backend.menu_tree(GEDIT_XID).expect("tree");
    let twin = backend
        .select_menu(GEDIT_XID, &["File", "Export"])
        .expect_err("two Export items");

    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].title, "File");
    let labels: Vec<&str> = tree[0]
        .children
        .iter()
        .map(|item| item.title.as_str())
        .collect();
    assert_eq!(labels, ["Export", "Export"]);
    assert_eq!(twin.code(), EngineCode::AmbiguousTarget);
    assert!(
        handle.performed().is_empty(),
        "an ambiguous path presses nothing, not even File"
    );
}

#[test]
fn a_refused_select_closes_every_menu_its_walk_opened() {
    let (fx, bar, file) = file_menu(&["Mark done", "Mark done later"], &[]);
    let (mut backend, handle) = fx.backend();

    let near_miss = backend
        .select_menu(GEDIT_XID, &["File", "Mark"])
        .expect_err("no item is labelled exactly Mark");

    assert_eq!(near_miss.code(), EngineCode::StaleRef);
    assert_eq!(handle.performed(), vec![(file, 0)], "only File was pressed");
    assert_eq!(handle.open_menus(), Vec::<NodeId>::new(), "File is closed again");
    assert_eq!(handle.cleared(), vec![bar]);
}

#[test]
fn a_press_refused_below_an_opened_menu_closes_it() {
    let (fx, bar, file) = file_menu(&["Mark done"], &["Mark done"]);
    let (mut backend, handle) = fx.backend();

    let refused = backend
        .select_menu(GEDIT_XID, &["File", "Mark done"])
        .expect_err("Mark done has no action");

    assert_eq!(refused.code(), EngineCode::AxUnsupported);
    assert_eq!(handle.performed(), vec![(file, 0)]);
    assert_eq!(handle.open_menus(), Vec::<NodeId>::new(), "File is closed again");
    assert_eq!(handle.cleared(), vec![bar]);
}
