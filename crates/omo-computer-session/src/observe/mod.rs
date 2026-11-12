//! One `observe`: a bounded walk of the window, a new generation, the rendered outline (the
//! skeleton by default, `actions` off), the focused element, and the lossless-or-full diff
//! against `since`. `drill(ref)` reads one subtree into a sub-generation; `find` answers from
//! the whole observed snapshot without another read.

mod project;
mod query;
mod verbs;

#[cfg(test)]
mod tests;

pub use project::Style;
pub use query::Criteria;

use omo_computer_core::ax::{walk, AxReader, Limits, RootRead};
use omo_computer_core::backend::{unknown_session_state, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::listing::ElementInfo;
use omo_computer_core::observation::{Cut, Observation};
use omo_computer_core::params::ObserveParams;
use omo_computer_core::requests::{read_observe, ReadRequest};
use omo_computer_core::untrusted::UntrustedText;

use crate::diff::{decide, Decision, Outline, Side};
use crate::refs::{Drilled, Generation, RefRegistry, Unresolved};

/// What one observe asks for, with the defaults applied: skeleton on, actions off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub target: String,
    pub since: Option<u64>,
    pub query: Option<String>,
    pub style: Style,
}

impl Request {
    #[must_use]
    pub fn read(params: ObserveParams) -> Self {
        let ReadRequest::Observe { target, spec, .. } = read_observe(params) else {
            unreachable!("read_observe always reads an observe");
        };
        Self {
            target,
            since: spec.since,
            query: spec.query.filter(|query| !query.trim().is_empty()),
            style: Style { skeleton: spec.skeleton.unwrap_or(true), depth: spec.depth, actions: spec.actions.unwrap_or(false) },
        }
    }

    /// The default read of `target`.
    #[must_use]
    pub fn of(target: &str) -> Self {
        Self { target: target.to_owned(), since: None, query: None, style: Style::default() }
    }
}

fn side(generation: &Generation, outline: Outline) -> Side {
    Side {
        generation: generation.number,
        outline,
        complete: generation.complete,
        menu_root: generation.menu_root,
        window: generation.window.clone(),
        projection: generation.projection,
    }
}

fn minted<'a>(refs: &'a RefRegistry, window: &str, number: u64) -> Result<&'a Generation, Refusal> {
    refs.generation(window, number).ok_or(Refusal::bare(EngineCode::StaleRef))
}

fn packet(generation: &Generation, nodes_observed: u32, cuts: Vec<Cut>) -> Observation {
    let focused: Option<ElementInfo> = (1..generation.entries.len())
        .find(|i| generation.entries[*i].read.focused == Some(true))
        .map(|i| generation.element_info(i));
    Observation {
        frame: None,
        tree: None,
        diff: None,
        diff_fallback: None,
        baseline: None,
        focused,
        selected_text: None,
        complete: generation.complete,
        nodes_observed,
        cuts,
        generation: generation.number,
        session: unknown_session_state(),
        observation: UntrustedText,
        secure: None,
        settle: None,
        ocr: None,
    }
}

/// Observes `request.target` through `reader` and mints its next generation.
///
/// # Errors
/// The reader's refusal of the window root (`WindowNotFound`, ...).
pub fn observe(refs: &mut RefRegistry, reader: &mut dyn AxReader, request: &Request) -> Result<Observation, Unresolved> {
    let root = reader.root(&request.target)?;
    let limits = Limits::of(reader);
    let read = walk(reader, root.node.clone(), &limits);
    let nodes = u32::try_from(read.nodes.len()).unwrap_or(u32::MAX);
    // The baseline is taken before the mint: the ninth observe ages the oldest one out.
    let baseline = request.since.and_then(|since| {
        let generation = refs.generation(&request.target, since).filter(|g| g.parent.is_none())?;
        Some(side(generation, generation.outline.clone()?))
    });
    let number = refs.mint(&root, &read, None).generation;
    let generation = minted(refs, &request.target, number)?;
    let (outline, cuts) = match &request.query {
        Some(phrase) => query::project(generation, phrase, nodes),
        None => project::render(generation, request.style, nodes),
    };
    let mut current = side(generation, outline.clone());
    current.projection = request.query.is_some();
    let mut packet = packet(generation, nodes, cuts);
    match request.since.map(|_| decide(baseline.as_ref(), &current, nodes)) {
        Some(Decision::Diff(diff)) => {
            packet.diff = Some(diff);
            packet.baseline = request.since;
        }
        Some(Decision::Full(reason)) => {
            packet.tree = Some(outline.text());
            packet.diff_fallback = Some(reason);
        }
        None => packet.tree = Some(outline.text()),
    }
    refs.attach(&request.target, number, outline, current.projection);
    Ok(packet)
}

/// Reads the subtree under `token` into a sub-generation of the token's generation; every
/// other generation stays valid.
///
/// # Errors
/// The resolution refusals of the token.
pub fn drill(refs: &mut RefRegistry, reader: &mut dyn AxReader, token: &str, depth: Option<u32>, object_mode: bool) -> Result<Observation, Unresolved> {
    let resolved = refs.resolve(token, object_mode, reader)?;
    let from = minted(refs, &resolved.window, resolved.generation)?;
    let identity = from.entries[resolved.index].identity.clone();
    let top = from.parent.unwrap_or(from.number);
    let root = RootRead { window: from.window.clone(), app: from.app.clone(), focused: from.window_focused, node: resolved.live.clone() };
    let mut limits = Limits::of(reader);
    if let Some(depth) = depth {
        limits.max_logical_depth = limits.max_logical_depth.min(depth);
    }
    let read = walk(reader, resolved.live, &limits);
    let nodes = u32::try_from(read.nodes.len()).unwrap_or(u32::MAX);
    let drilled = Drilled { top, from: resolved.generation, index: resolved.index, identity: &identity };
    let number = refs.mint(&root, &read, Some(drilled)).generation;
    let generation = minted(refs, &resolved.window, number)?;
    let style = Style { skeleton: false, depth, actions: false };
    let (outline, cuts) = project::render(generation, style, nodes);
    let mut packet = packet(generation, nodes, cuts);
    packet.tree = Some(outline.text());
    refs.attach(&resolved.window, number, outline, false);
    Ok(packet)
}

/// The elements of `window`'s newest observation that `criteria` names: the whole observed
/// snapshot, not only the rendered lines, and no read of the backend.
#[must_use]
pub fn find(refs: &RefRegistry, window: &str, criteria: &Criteria) -> Vec<ElementInfo> {
    refs.latest(window).map(|generation| query::find(generation, criteria)).unwrap_or_default()
}
