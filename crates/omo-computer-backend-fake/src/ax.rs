//! `AxBackend` for the fake: snapshots of the scripted trees under the observation deadline,
//! ref resolution, semantic actions into the sink, and the observer-event timeline.

use omo_computer_core::backend::{
    AxBackend, AxEventSource, AxSnapshot, BackendResult, Delivered, Ref, Refusal, RefusalCode,
    Resolved, Semantic, SnapshotRequest, Target,
};

use crate::ax_tree::{element_info, flatten, parse_ref, render, NODES_PER_MS};
use crate::backend::FakeBackend;
use crate::handles::FakeAxEvents;
use crate::method::FakeMethod;
use crate::scenario::FakeAxNode;
use crate::state::{CallOutcome, FakeState};

fn refuse(reason: &'static str) -> Refusal {
    Refusal::new(RefusalCode::AxUnavailable, reason)
}

/// The node a ref names and the window it lives in.
fn lookup<'a>(
    state: &'a FakeState,
    reference: &Ref,
) -> BackendResult<(&'a FakeAxNode, String, u64)> {
    let (generation, index) = parse_ref(&reference.0).ok_or_else(|| refuse("ref_malformed"))?;
    let window = state
        .snapshots
        .get(&generation)
        .ok_or_else(|| refuse("ref_not_found"))?;
    if state.exited.contains(window) {
        return Err(refuse("target_gone"));
    }
    let root = state
        .scenario
        .ax
        .get(window)
        .ok_or_else(|| refuse("ref_not_found"))?;
    let (_, node) = flatten(root)
        .get(index)
        .copied()
        .ok_or_else(|| refuse("ref_not_found"))?;
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
                return Err(refuse("window_target_required"));
            };
            if state.exited.contains(window) {
                return Err(refuse("target_gone"));
            }
            let root = state
                .scenario
                .ax
                .get(window)
                .ok_or_else(|| refuse("no_tree"))?;
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
            Ok(Resolved {
                element: element_info(&reference.0, node, &window, generation),
            })
        })
    }

    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        self.call(FakeMethod::of_action(&action.0), |state, outcome| {
            let (node, _, _) = lookup(state, reference)?;
            if !supports(node, &action.0) {
                return Err(refuse("action_unsupported"));
            }
            let mut line = format!("ax_perform ref={} action={}", reference.0, action.0);
            if outcome == CallOutcome::CannotComplete {
                line.push_str(" outcome=cannot_complete");
            }
            self.sink.record(line);
            // A write left unanswered went out, but nothing confirms it completed.
            let count = u32::from(outcome == CallOutcome::Proceed);
            Ok(Delivered { count, of: 1 })
        })
    }

    fn events(&mut self) -> Box<dyn AxEventSource> {
        Box::new(FakeAxEvents::new(self.shared.clone(), self.clock.clone()))
    }
}

#[cfg(test)]
mod tests;
