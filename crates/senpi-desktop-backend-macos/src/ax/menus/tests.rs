use super::*;

#[test]
fn shortcut_renders_the_upstream_modifier_vocabulary() {
    // AXMenuItemCmdModifiers: Shift=1, Option=2, Control=4, NoCommand=8.
    assert_eq!(render_shortcut("S", 0), Some("Cmd+S".to_string()));
    assert_eq!(render_shortcut("S", 8), Some("S".to_string()));
    assert_eq!(render_shortcut("P", 1), Some("Shift+Cmd+P".to_string()));
    assert_eq!(render_shortcut("E", 2), Some("Alt+Cmd+E".to_string()));
    assert_eq!(render_shortcut("K", 6), Some("Ctrl+Alt+Cmd+K".to_string()));
    assert_eq!(render_shortcut("K", 7), Some("Ctrl+Alt+Shift+Cmd+K".to_string()));
    assert_eq!(render_shortcut("1", 15), Some("Ctrl+Alt+Shift+1".to_string()));
}

#[test]
fn an_item_without_a_command_key_has_no_shortcut() {
    assert_eq!(render_shortcut("", 0), None);
}

fn roles(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn the_single_axmenu_child_is_the_submenu() {
    assert_eq!(pick_submenu_index(&roles(&["AXMenu"])).ok(), Some(Some(0)));
    assert_eq!(
        pick_submenu_index(&roles(&["AXMenuItem", "AXMenu"])).ok(),
        Some(Some(1))
    );
}

#[test]
fn no_axmenu_child_means_no_submenu() {
    assert_eq!(pick_submenu_index(&roles(&[])).ok(), Some(None));
    assert_eq!(
        pick_submenu_index(&roles(&["AXMenuItem", "AXSeparatorItem"])).ok(),
        Some(None)
    );
}

#[test]
fn a_second_axmenu_child_is_refused_not_treated_as_no_submenu() {
    let ambiguous = pick_submenu_index(&roles(&["AXMenu", "AXMenuItem", "AXMenu"]));
    assert_eq!(
        ambiguous.map_err(|error| error.code),
        Err(senpi_desktop_core::error::ErrorCode::AxFailed)
    );
}
