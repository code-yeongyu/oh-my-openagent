//! Re-identification by evidence, before any OS call that acts on a ref. Rung 1 asks the
//! retained handle; rung 2 scans the cached snapshot of a newer observation of the window;
//! rung 3 reads only the window below the ref's recorded ancestors. Every answer is checked
//! against the evidence tuple: one match resolves, none is `StaleRef{saved_ref_absent}`, two
//! or more are `AmbiguousTarget{candidates}` (the bounds hash breaks a tie only), and an
//! unread label on the only candidate is `Timeout{resolution_identity_unknown}`. No rung
//! takes a first match.

use omo_computer_core::ax::{walk, AxReader, Limits, NodeRead, Slice, MAX_LOGICAL_DEPTH, SLICE_MS};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::ElementInfo;

use super::entry::{identities, Identity};
use super::RefRegistry;

/// The live element a token re-identified to, in the generation that holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub window: String,
    pub generation: u64,
    pub index: usize,
    pub live: NodeRead,
}

/// A refusal with nothing sent; `candidates` is set on `AmbiguousTarget`.
#[derive(Debug, Clone, PartialEq)]
pub struct Unresolved {
    pub refusal: Refusal,
    pub candidates: Vec<ElementInfo>,
}

impl From<Refusal> for Unresolved {
    fn from(refusal: Refusal) -> Self {
        Self { refusal, candidates: Vec::new() }
    }
}

const fn identity_unknown() -> Refusal {
    Refusal::new(EngineCode::Timeout, Reason::ResolutionIdentityUnknown.wire())
}

/// One live element the tuple may name: in a cached generation (`Some((generation, index))`)
/// or read live by rung 3.
struct Candidate {
    at: Option<(u64, usize)>,
    identity: Identity,
    read: NodeRead,
}

impl RefRegistry {
    /// Resolves `token` to its live element through the ladder.
    ///
    /// # Errors
    /// The refusals of [`RefRegistry::locate`], `StaleRef{not_unique_at_capture}`,
    /// `StaleRef{saved_ref_absent}`, `AmbiguousTarget` with candidates,
    /// `Timeout{resolution_identity_unknown}`.
    pub fn resolve(&mut self, token: &str, object_mode: bool, reader: &mut dyn AxReader) -> Result<Resolved, Unresolved> {
        let (window, number, index) = self.locate(token, object_mode)?;
        let generation = self.generation(&window, number).ok_or(Refusal::bare(EngineCode::StaleRef))?;
        let entry = generation.entries[index].clone();
        let top = generation.parent.unwrap_or(number);
        if let Some(handle) = entry.handle {
            match reader.node(handle, SLICE_MS) {
                Slice::Hung => return Err(identity_unknown().into()),
                Slice::Read(Some(live)) if live.stable_text_unknown() && live.role == entry.identity.role => {
                    return Err(identity_unknown().into())
                }
                Slice::Read(Some(live)) if same_element(&entry.identity, &live) => {
                    return Ok(Resolved { window, generation: number, index, live });
                }
                Slice::Read(_) => {}
            }
        }
        if !entry.identity.unique_at_capture {
            return Err(Refusal::new(EngineCode::StaleRef, Reason::NotUniqueAtCapture.wire()).into());
        }
        let newer = self.latest(&window).filter(|latest| latest.number > top).map(|latest| latest.number);
        let mut candidates = match newer {
            Some(latest) => self.cached(&window, latest, &entry.identity),
            None => live(reader, &window, &entry.identity)?,
        };
        if candidates.len() > 1 {
            let same_bounds: Vec<usize> = (0..candidates.len())
                .filter(|i| candidates[*i].identity.bounds_hash == entry.identity.bounds_hash)
                .collect();
            if let [only] = same_bounds[..] {
                candidates = vec![candidates.swap_remove(only)];
            }
        }
        match candidates.as_slice() {
            [] => Err(Refusal::new(EngineCode::StaleRef, Reason::SavedRefAbsent.wire()).into()),
            [only] if only.identity.stable_text_unknown => Err(identity_unknown().into()),
            [only] => {
                let live = only.read.clone();
                let (found_in, found_at) = only.at.unwrap_or((number, index));
                if let Some(entry) = self.windows.get_mut(&window).and_then(|w| w.generations.get_mut(&number)).map(|g| &mut g.entries[index]) {
                    entry.handle = live.handle;
                }
                Ok(Resolved { window, generation: found_in, index: found_at, live })
            }
            many => Err(Unresolved {
                refusal: Refusal::bare(EngineCode::AmbiguousTarget),
                candidates: many.iter().map(|c| self.describe(&window, c, token)).collect(),
            }),
        }
    }

    fn cached(&self, window: &str, number: u64, wanted: &Identity) -> Vec<Candidate> {
        let Some(generation) = self.generation(window, number) else { return Vec::new() };
        generation
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| entry.identity.may_match(wanted))
            .map(|(index, entry)| Candidate { at: Some((number, index)), identity: entry.identity.clone(), read: entry.read.clone() })
            .collect()
    }

    fn describe(&self, window: &str, candidate: &Candidate, token: &str) -> ElementInfo {
        if let Some((number, index)) = candidate.at {
            if let Some(generation) = self.generation(window, number) {
                return generation.element_info(index);
            }
        }
        ElementInfo {
            reference: token.to_owned(),
            role: candidate.read.role.clone(),
            label: omo_computer_core::ax::label(&candidate.read).map(str::to_owned),
            native_role: candidate.read.native_role.clone(),
            title: candidate.read.title.clone(),
            description: candidate.read.description.clone(),
            value: None,
            enabled: candidate.read.enabled,
            focused: candidate.read.focused,
            child_count: Some(candidate.read.child_count),
            bounds: candidate.read.bounds,
            actions: Some(candidate.read.actions.clone()),
            window: window.to_owned(),
            generation: 0,
            observation: omo_computer_core::untrusted::UntrustedText,
        }
    }
}

/// Rung 1's check on a fresh handle read: role, stable text and native id.
fn same_element(identity: &Identity, live: &NodeRead) -> bool {
    identity.role == live.role
        && identity.native_id == live.native_id
        && identity.stable_text.as_deref() == live.stable_text()
}

/// Rung 3: a bounded read of the window, at most 8 levels below the ref's ancestors.
fn live(reader: &mut dyn AxReader, window: &str, wanted: &Identity) -> Result<Vec<Candidate>, Unresolved> {
    let root = reader.root(window)?;
    let depth = u32::try_from(wanted.ancestor_path.split('/').count()).unwrap_or(u32::MAX);
    let limits = Limits { max_logical_depth: depth.saturating_add(8).min(MAX_LOGICAL_DEPTH), ..Limits::of(reader) };
    let read = walk(reader, root.node, &limits);
    let ids = identities(&read, None);
    Ok(read
        .nodes
        .into_iter()
        .zip(ids)
        .filter(|(_, identity)| identity.may_match(wanted))
        .map(|(node, identity)| Candidate { at: None, identity, read: node.read })
        .collect())
}
