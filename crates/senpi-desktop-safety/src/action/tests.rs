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
