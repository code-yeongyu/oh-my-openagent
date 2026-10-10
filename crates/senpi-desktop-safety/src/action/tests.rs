use std::collections::HashSet;

use senpi_desktop_core::methods::{Effect, Exposure, METHODS};

use super::MutatingAction;

#[test]
fn mutating_actions_are_exactly_the_public_exec_methods() {
    // Given: the frozen engine method table
    let public_exec: HashSet<_> = METHODS
        .iter()
        .filter(|spec| spec.effect == Effect::Exec && spec.exposure == Exposure::Public)
        .map(|spec| spec.method)
        .collect();

    // When
    let gated: HashSet<_> = MutatingAction::ALL.iter().map(|action| action.method()).collect();

    // Then: no mutating request can reach a backend without a variant
    assert_eq!(gated, public_exec);
    assert_eq!(gated.len(), MutatingAction::ALL.len());
}

#[test]
fn every_mutating_action_names_its_engine_method() {
    for action in MutatingAction::ALL {
        let _method = action.method();
    }
}

#[test]
fn menu_select_is_a_mutating_action_and_menu_items_is_not() {
    use senpi_desktop_core::methods::Method;
    assert_eq!(
        MutatingAction::MenuSelect.method(),
        Method::from_name("menus.select").expect("menus.select is a method")
    );
    assert!(
        !MutatingAction::ALL
            .iter()
            .any(|action| action.method().spec().name == "menus.items"),
        "menus.items is a read and never passes the mutation gate"
    );
}
