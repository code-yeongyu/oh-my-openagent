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

#[test]
fn submenu_child_returns_the_single_axmenu_child() {
    struct Stub(Vec<&'static str>);
    impl SubmenuNode for Stub {
        fn child_roles(&self) -> Vec<&'static str> {
            self.0.clone()
        }
    }
    assert_eq!(submenu_child(&Stub(vec!["AXMenu"])), Some(0));
    assert_eq!(submenu_child(&Stub(vec!["AXMenuItem", "AXMenu"])), Some(1));
    assert_eq!(submenu_child(&Stub(vec![])), None);
    assert_eq!(submenu_child(&Stub(vec!["AXMenuItem", "AXSeparatorItem"])), None);
}

#[test]
fn a_second_axmenu_child_is_ambiguous_and_refused() {
    struct Stub(Vec<&'static str>);
    impl SubmenuNode for Stub {
        fn child_roles(&self) -> Vec<&'static str> {
            self.0.clone()
        }
    }
    let ambiguous = submenu_child(&Stub(vec!["AXMenu", "AXMenu"]));
    assert_eq!(ambiguous, None, "two AXMenu children must not descend");
}
