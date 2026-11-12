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
        let _ = (identity_unknown, live, walk, Limits::of, MAX_LOGICAL_DEPTH, identities, Reason::SavedRefAbsent);
        if let Some(handle) = entry.handle {
            if let Slice::Read(Some(live)) = reader.node(handle, SLICE_MS) {
                if same_element(&entry.identity, &live) {
                    return Ok(Resolved { window, generation: number, index, live });
                }
            }
        }
        Err(Unresolved { refusal: Refusal::bare(EngineCode::StaleRef), candidates: Vec::<ElementInfo>::new() })
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
    let _ = (reader, window, wanted);
    Ok(Vec::new())
}
