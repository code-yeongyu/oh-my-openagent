//! The watched send: every event in order through the one side-effect sink, a text as one
//! interruptible stroke counted in Unicode scalars, and between units the mid-send watch
//! (physical input in the target under policy `pause`) and the target's liveness. Nothing is
//! sent after the unit at which either fires, and nothing is ever re-sent.

use omo_computer_core::backend::{Backend, InputEvent, Refusal, Route, TaggedInput};
use omo_computer_core::error::EngineCode;
use omo_computer_core::intervention::{scalars, TargetLiveness};
use omo_computer_core::report::Disposition;

use super::MidSend;
use crate::liveness::{exited, WINDOW_NOT_FOUND};
use crate::Session;

/// Why a send stopped before its last unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    Refused(Refusal),
    Intervened,
    Exited(TargetLiveness),
}

/// `count` of `of` units went out; `stop` says why the rest did not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub count: u32,
    pub of: u32,
    pub stop: Option<Stop>,
}

/// The units of `delivered{count, of}`: one per event, the scalars of a text.
#[must_use]
pub fn units(events: &[InputEvent]) -> u32 {
    events
        .iter()
        .map(|event| match event {
            InputEvent::Text(text) => scalars(text),
            InputEvent::PointerMove(_)
            | InputEvent::Button { .. }
            | InputEvent::Key { .. }
            | InputEvent::Scroll { .. } => 1,
        })
        .fold(0, u32::saturating_add)
}

fn boundary_stop(
    backend: &dyn Backend,
    watch: Option<MidSend>,
    window: Option<&str>,
) -> Option<Stop> {
    if let Some(liveness) = exited(backend, window) {
        return Some(Stop::Exited(liveness));
    }
    watch
        .is_some_and(|watch| watch.intervened(backend))
        .then_some(Stop::Intervened)
}

/// How a send that stopped after its first unit is answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ended {
    pub refusal: Refusal,
    pub disposition: Disposition,
    /// The disposition put on the wire; `None` leaves the code's own row to say it.
    pub interrupted: Option<Disposition>,
    pub target: Option<TargetLiveness>,
}

impl Ended {
    #[must_use]
    pub fn of(stop: Stop, count: u32) -> Self {
        match stop {
            Stop::Refused(refusal) => Self {
                refusal,
                disposition: Disposition::UNCERTAIN_UNSAFE,
                interrupted: Some(Disposition::UNCERTAIN_UNSAFE),
                target: None,
            },
            Stop::Intervened => Self {
                refusal: Refusal::bare(EngineCode::UserIntervened),
                disposition: if count == 0 {
                    Disposition::NOT_DELIVERED_AFTER_USER
                } else {
                    Disposition::DELIVERED_UNVERIFIED
                },
                interrupted: None,
                target: None,
            },
            Stop::Exited(target) => Self {
                refusal: WINDOW_NOT_FOUND,
                disposition: Disposition::UNCERTAIN_UNSAFE,
                interrupted: Some(Disposition::UNCERTAIN_UNSAFE),
                target: Some(target),
            },
        }
    }
}

impl Session {
    /// A stop is never held (R53): the listener is polled between units, and a set latch ends
    /// the stroke there with the latch's own `Suspended{reason}`.
    fn latched(&mut self) -> Option<Stop> {
        let backend = &mut self.backend;
        self.guard.observe(&mut || backend.stop_listener(), &mut omo_computer_safety::NoHolds);
        self.guard.latch().map(|reason| Stop::Refused(reason.refusal()))
    }

    pub(crate) fn send_watched(
        &mut self,
        events: Vec<InputEvent>,
        route: Route,
        tag: u64,
        watch: Option<MidSend>,
        window: Option<&str>,
    ) -> Outcome {
        let of = units(&events);
        let mut count: u32 = 0;
        for (index, event) in events.into_iter().enumerate() {
            if index > 0 {
                if let Some(stop) = boundary_stop(self.backend.as_ref(), watch, window) {
                    return Outcome { count, of, stop: Some(stop) };
                }
            }
            if let InputEvent::Text(text) = event {
                let mut interrupt =
                    |backend: &dyn Backend| boundary_stop(backend, watch, window).is_some();
                let delivery = self.backend.post_text(&text, route, tag, &mut interrupt);
                count = count.saturating_add(delivery.sent);
                if let Some(refusal) = delivery.refusal {
                    return Outcome { count, of, stop: Some(Stop::Refused(refusal)) };
                }
                if delivery.interrupted {
                    let stop = boundary_stop(self.backend.as_ref(), watch, window)
                        .unwrap_or(Stop::Intervened);
                    return Outcome { count, of, stop: Some(stop) };
                }
                continue;
            }
            match self.backend.post_input(&TaggedInput { event, tag }, route) {
                Ok(_) => count = count.saturating_add(1),
                Err(refusal) => {
                    return Outcome { count, of, stop: Some(Stop::Refused(refusal)) }
                }
            }
        }
        Outcome { count, of, stop: None }
    }
}
