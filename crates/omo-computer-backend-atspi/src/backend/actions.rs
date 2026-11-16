//! The action-resolution ladder: `press` resolves to the one command action the element
//! offers (`activate`, the default action, ...); none is the typed refusal and two are
//! ambiguous, decided before anything is sent. Names are read per index, never batched.

use omo_computer_core::backend::{Delivered, Ref, Refusal, Resolved, Semantic};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::ElementInfo;
use omo_computer_core::untrusted::UntrustedText;

use super::AtspiBackend;
use crate::bus::{mutation_slice, read_slice, Bus, BusError, NodeId, CALL_BUDGET};
use crate::roles::is_press_rung;
use crate::types::{AxRefusal, Detail};

/// The most action names one element is asked for (`d-linux.md` '### Tree').
pub const MAX_ACTIONS: i32 = 64;

fn budget_ms() -> u64 {
    u64::try_from(CALL_BUDGET.as_millis()).unwrap_or(u64::MAX)
}

fn gone(error: &BusError) -> AxRefusal {
    match error {
        BusError::Timeout => AxRefusal::plain(Refusal::bare(EngineCode::Timeout)),
        BusError::Unreachable => AxRefusal::no_bus(),
        BusError::Failed(_) => AxRefusal::plain(Refusal::bare(EngineCode::StaleRef)),
    }
}

/// Presses `node` through the ladder; `role` is its AT-SPI role.
pub(crate) fn press<B: Bus>(
    bus: &mut B,
    node: &NodeId,
    role: &str,
) -> Result<Delivered, AxRefusal> {
    let slice = read_slice(budget_ms());
    let count = bus
        .action_count(node, slice)
        .map_err(|error| gone(&error))?
        .clamp(0, MAX_ACTIONS);
    let mut names = Vec::new();
    for index in 0..count {
        names.push(
            bus.action_name(node, index, slice)
                .map_err(|error| gone(&error))?,
        );
    }
    let rungs: Vec<usize> = names
        .iter()
        .enumerate()
        .filter(|(_, name)| is_press_rung(role, name))
        .map(|(i, _)| i)
        .collect();
    let index = match rungs.as_slice() {
        [] => {
            return Err(AxRefusal::new(
                Refusal::bare(EngineCode::AxUnsupported),
                Detail::NoAction {
                    role: role.to_owned(),
                    actions: names,
                },
            ))
        }
        [one] => i32::try_from(*one).unwrap_or(i32::MAX),
        _ => {
            let candidates = rungs.iter().map(|i| names[*i].clone()).collect();
            return Err(AxRefusal::new(
                Refusal::bare(EngineCode::AmbiguousTarget),
                Detail::AmbiguousAction { candidates },
            ));
        }
    };
    match bus.do_action(node, index, mutation_slice(budget_ms())) {
        Ok(true) => Ok(Delivered { count: 1, of: 1 }),
        Ok(false) => Err(AxRefusal::plain(Refusal::bare(EngineCode::AxFailed))),
        Err(BusError::Timeout) => Err(AxRefusal::plain(Refusal::bare(EngineCode::AxUnconfirmed))),
        Err(error) => Err(gone(&error)),
    }
}

impl<B: Bus> AtspiBackend<B> {
    /// Performs `action` on the element `reference` names.
    ///
    /// # Errors
    /// An action outside the vocabulary, the ref's re-identification refusal, an element with
    /// no Action interface (refused with zero bus calls), or the ladder's refusal.
    pub fn perform_detailed(
        &mut self,
        reference: &Ref,
        action: &Semantic,
    ) -> Result<Delivered, AxRefusal> {
        if action.0 != "press" {
            return Err(AxRefusal::plain(Refusal::new(
                EngineCode::AxUnsupported,
                Reason::PerformUnsupported.wire(),
            )));
        }
        let (_, entry) = self.refs.entry(&reference.0)?;
        let (node, role, actionable) = (
            entry.node.clone(),
            entry.native_role.clone(),
            entry.actionable,
        );
        if !actionable {
            return Err(AxRefusal::new(
                Refusal::bare(EngineCode::AxUnsupported),
                Detail::NoAction {
                    role,
                    actions: Vec::new(),
                },
            ));
        }
        let node = node.ok_or_else(|| AxRefusal::plain(Refusal::bare(EngineCode::StaleRef)))?;
        let bus = self.live()?;
        press(bus, &node, &role)
    }

    /// The live element a ref names, re-read once.
    ///
    /// # Errors
    /// The ref's re-identification refusal, or an object gone from the bus (`StaleRef`).
    pub fn resolve_detailed(&mut self, reference: &Ref) -> Result<Resolved, AxRefusal> {
        let (generation, entry) = self.refs.entry(&reference.0)?;
        let (window, entry) = (generation.window.clone(), entry.clone());
        let node = entry
            .node
            .clone()
            .ok_or_else(|| AxRefusal::plain(Refusal::bare(EngineCode::StaleRef)))?;
        let token = omo_computer_core::ax::RefToken::parse(&reference.0);
        let generation = token.map_or(0, |token| match token {
            omo_computer_core::ax::RefToken::Qualified { generation, .. } => generation,
            omo_computer_core::ax::RefToken::Bare { .. } => 0,
        });
        let bus = self.live()?;
        let facts = bus
            .read(&node, read_slice(budget_ms()))
            .map_err(|error| gone(&error))?;
        if facts.role != entry.native_role {
            return Err(AxRefusal::plain(Refusal::new(
                EngineCode::StaleRef,
                Reason::IdentityChanged.wire(),
            )));
        }
        let read = &entry.read;
        let element = ElementInfo {
            reference: reference.0.clone(),
            role: read.role.clone(),
            label: omo_computer_core::ax::label(read).map(str::to_owned),
            native_role: read.native_role.clone(),
            title: facts.name.clone(),
            description: facts.description.clone(),
            value: if read.secure {
                None
            } else {
                read.value.clone()
            },
            enabled: Some(facts.states.enabled),
            focused: Some(facts.states.focused),
            child_count: Some(facts.child_count),
            bounds: read.bounds,
            actions: None,
            window,
            generation,
            observation: UntrustedText,
        };
        Ok(Resolved { element })
    }
}
