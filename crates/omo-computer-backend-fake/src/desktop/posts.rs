//! Row 23's scripted post counting (moved from desktop.rs, R65a: no change): the stop chord
//! after N posts (`stop_chord_after_posts`) and the per-call scroll cap (`scroll_cap`).

use omo_computer_core::backend::{Delivered, InputEvent};

use crate::state::FakeState;

/// Counts one post; `Some` is a scroll the scenario's cap answers with nothing delivered.
pub(super) fn count(state: &mut FakeState, event: &InputEvent) -> Option<Delivered> {
    state.posts = state.posts.saturating_add(1);
    if state.scenario.stop_chord_after_posts == Some(state.posts) {
        state.stop_pressed = true;
    }
    if matches!(event, InputEvent::Scroll { .. }) {
        state.scroll_run = state.scroll_run.saturating_add(1);
        if state.scenario.scroll_cap.is_some_and(|cap| state.scroll_run > cap) {
            return Some(Delivered { count: 0, of: 1 });
        }
    } else {
        state.scroll_run = 0;
    }
    None
}
