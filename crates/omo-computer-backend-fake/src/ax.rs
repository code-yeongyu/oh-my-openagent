//! `AxBackend` for the fake: snapshots of the scripted trees under the observation deadline,
//! ref resolution, semantic actions into the sink, and the observer-event timeline.

use omo_computer_core::backend::{
    AxBackend, AxEventSource, AxSnapshot, BackendResult, Delivered, Ref, Refusal, Resolved,
    Semantic, SnapshotRequest, Target,
};
use omo_computer_core::error::{EngineCode, Reason};

use crate::ax_tree::{element_info, flatten, parse_ref, render, NODES_PER_MS};
use crate::backend::FakeBackend;
use crate::handles::FakeAxEvents;
use crate::method::FakeMethod;
use crate::scenario::FakeAxNode;
use crate::state::{CallOutcome, FakeState};

fn stale() -> Refusal {
    Refusal::bare(EngineCode::StaleRef)
}

/// The store key of the node a ref names.
fn value_key(reference: &Ref, window: &str) -> String {
    let index = parse_ref(&reference.0).map_or(0, |(_, index)| index);
    format!("{window}#{index}")
}

/// The node a ref names and the window it lives in.
fn lookup<'a>(
    state: &'a FakeState,
    reference: &Ref,
) -> BackendResult<(&'a FakeAxNode, String, u64)> {
    let (generation, index) = parse_ref(&reference.0)
        .ok_or_else(|| Refusal::new(EngineCode::InvalidTarget, Reason::RefUnqualified.wire()))?;
    let window = state.snapshots.get(&generation).ok_or_else(stale)?;
    if state.exited.contains(window) {
        return Err(Refusal::new(
            EngineCode::StaleRef,
            Reason::IdentityChanged.wire(),
        ));
    }
    let root = state.scenario.ax.get(window).ok_or_else(stale)?;
    let (_, node) = flatten(root).get(index).copied().ok_or_else(stale)?;
    Ok((node, window.clone(), generation))
}

fn supports(node: &FakeAxNode, action: &str) -> bool {
    match action {
        "set_value" | "type_text" => node.value.is_some(),
        _ => node.actions.iter().any(|listed| listed == action),
    }
}

impl AxBackend for FakeBackend {
    fn snapshot(&mut self, request: &SnapshotRequest) -> BackendResult<AxSnapshot> {
        self.call(FakeMethod::AxSnapshot, |state, _| {
            let Target::Window(window) = &request.target else {
                return Err(Refusal::bare(EngineCode::InvalidTarget));
            };
            if state.exited.contains(window) {
                return Err(Refusal::bare(EngineCode::WindowNotFound));
            }
            let root = state
                .scenario
                .ax
                .get(window)
                .ok_or_else(|| Refusal::bare(EngineCode::AxFailed))?;
            let nodes = flatten(root);
            let padded = state
                .scenario
                .ax_node_count
                .get(window)
                .copied()
                .unwrap_or(0);
            let total = nodes
                .len()
                .max(usize::try_from(padded).unwrap_or(usize::MAX));
            let budget = state.scenario.ax_deadline_ms.map_or(usize::MAX, |ms| {
                usize::try_from(ms.saturating_mul(NODES_PER_MS)).unwrap_or(usize::MAX)
            });
            let observed = total.min(budget);
            let cost = u64::try_from(observed)
                .unwrap_or(u64::MAX)
                .div_ceil(NODES_PER_MS);
            self.clock.advance(cost);
            let tree = render(&nodes, total, observed);
            let generation = state
                .snapshots
                .keys()
                .next_back()
                .map_or(1, |last| last + 1);
            state.snapshots.insert(generation, window.clone());
            Ok(AxSnapshot {
                tree,
                nodes_observed: u32::try_from(observed).unwrap_or(u32::MAX),
                complete: observed == total,
                generation,
            })
        })
    }

    fn resolve(&mut self, reference: &Ref) -> BackendResult<Resolved> {
        self.call(FakeMethod::AxResolve, |state, _| {
            let (node, window, generation) = lookup(state, reference)?;
            let mut element = element_info(&reference.0, node, &window, generation);
            if let Some(written) = state.ax_values.get(&value_key(reference, &window)) {
                element.value = Some(written.clone());
            }
            Ok(Resolved { element })
        })
    }

    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        self.call(FakeMethod::of_action(&action.0), |state, outcome| {
            let (node, _, _) = lookup(state, reference)?;
            if !supports(node, &action.0) {
                return Err(Refusal::new(
                    EngineCode::AxUnsupported,
                    Reason::PerformUnsupported.wire(),
                ));
            }
            let mut line = format!("ax_perform ref={} action={}", reference.0, action.0);
            if outcome == CallOutcome::CannotComplete {
                line.push_str(" outcome=cannot_complete");
            }
            self.sink.record(line);
            // An unanswered write went out and nothing confirms it: `AxUnconfirmed`, whose
            // table row reads `delivery_uncertain/unsafe` with something sent.
            if outcome == CallOutcome::CannotComplete {
                return Err(Refusal::bare(EngineCode::AxUnconfirmed));
            }
            Ok(Delivered { count: 1, of: 1 })
        })
    }

    fn set_value(&mut self, reference: &Ref, value: &str) -> BackendResult<Delivered> {
        self.call(FakeMethod::AxSetValue, |state, outcome| {
            let (node, window, _) = lookup(state, reference)?;
            if !supports(node, "set_value") {
                return Err(Refusal::new(EngineCode::AxUnsupported, Reason::PerformUnsupported.wire()));
            }
            let key = value_key(reference, &window);
            state.ax_values.insert(key, value.to_owned());
            self.sink.record(format!("ax_set_value ref={} chars={}", reference.0, value.chars().count()));
            if outcome == CallOutcome::CannotComplete {
                return Err(Refusal::bare(EngineCode::AxUnconfirmed));
            }
            Ok(Delivered { count: 1, of: 1 })
        })
    }

    fn read_value(&mut self, reference: &Ref) -> BackendResult<Option<String>> {
        let state = self.lock();
        let (node, window, _) = lookup(&state, reference)?;
        if let Some(scripted) = state.scenario.value_readback.as_ref().and_then(|map| map.get(reference.0.rsplit(':').next().unwrap_or(&reference.0))) {
            return Ok(scripted.clone());
        }
        Ok(state.ax_values.get(&value_key(reference, &window)).cloned().or_else(|| node.value.clone()))
    }

    fn insert_text(&mut self, reference: &Ref, text: &str) -> BackendResult<Delivered> {
        self.call(FakeMethod::AxTypeText, |state, outcome| {
            let (node, window, _) = lookup(state, reference)?;
            if !supports(node, "type_text") {
                return Err(Refusal::new(EngineCode::AxUnsupported, Reason::PerformUnsupported.wire()));
            }
            let key = value_key(reference, &window);
            let before = state.ax_values.get(&key).cloned().or_else(|| node.value.clone()).unwrap_or_default();
            state.ax_values.insert(key, before + text);
            self.sink.record(format!("ax_type_text ref={} chars={}", reference.0, text.chars().count()));
            if outcome == CallOutcome::CannotComplete {
                return Err(Refusal::bare(EngineCode::AxUnconfirmed));
            }
            Ok(Delivered { count: 1, of: 1 })
        })
    }

    fn focus(&mut self, reference: &Ref) -> BackendResult<Delivered> {
        self.call(FakeMethod::AxFocus, |state, outcome| {
            lookup(state, reference)?;
            self.sink.record(format!("ax_focus ref={}", reference.0));
            if outcome == CallOutcome::CannotComplete {
                return Err(Refusal::bare(EngineCode::AxUnconfirmed));
            }
            Ok(Delivered { count: 1, of: 1 })
        })
    }

    fn events(&mut self) -> Box<dyn AxEventSource> {
        Box::new(FakeAxEvents::new(self.shared.clone(), self.clock.clone()))
    }
}

#[cfg(test)]
mod tests;
