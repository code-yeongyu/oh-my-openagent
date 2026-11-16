//! Input: the one sink every posted event lands in, with the cursor and held keys it moves.

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Route, TaggedInput};

use crate::backend::FakeBackend;
use crate::method::FakeMethod;
use crate::sink::quoted;

fn event_line(event: &InputEvent) -> String {
    match event {
        InputEvent::PointerMove(point) => format!("pointer_move x={} y={}", point.x, point.y),
        InputEvent::Button { button, down } => {
            format!("button {button:?} down={down}").to_lowercase()
        }
        InputEvent::Key { key, down } => format!("key {} down={down}", quoted(key)),
        InputEvent::Scroll { dx, dy } => format!("scroll dx={dx} dy={dy}"),
        InputEvent::Text(text) => format!("text {}", quoted(text)),
        row25 => super::shell::event_line(row25),
    }
}

impl FakeBackend {
    pub(super) fn record_input(
        &mut self,
        input: &TaggedInput,
        route: Route,
    ) -> BackendResult<Delivered> {
        self.call(FakeMethod::of_input(&input.event), |state, _| {
            if let InputEvent::AppQuit { app_key, .. } = &input.event {
                let app = state.scenario.apps.iter().find(|a| &a.app_key == app_key).map(|a| (a.pid, a.name.clone()));
                let quit: Vec<String> = state
                    .windows
                    .iter()
                    .filter(|w| &w.app == app_key || app.as_ref().is_some_and(|(pid, name)| *pid == Some(w.pid) || &w.app == name))
                    .map(|w| w.id.clone())
                    .collect();
                state.exited.extend(quit);
            }
            if let Some(capped) = super::posts::count(state, &input.event) {
                return Ok(capped);
            }
            match &input.event {
                InputEvent::PointerMove(point) => state.cursor = Some(*point),
                InputEvent::Key { key, down: true } => {
                    state.held.insert(key.clone());
                }
                InputEvent::Key { key, down: false } => {
                    state.held.remove(key);
                }
                _ => {}
            }
            let route = format!("{route:?}").to_lowercase();
            self.sink.record(format!(
                "post_input route={route} tag={} {}",
                input.tag,
                event_line(&input.event)
            ));
            Ok(Delivered { count: 1, of: 1 })
        })
    }
}
