//! The side-effect funnel. Every mutating method reaches the backend only through
//! `Session::mutate`: the safety gate, the binding `(issuer, scope, callId, runGeneration)`,
//! the pre-input marker (persisted before the first OS call), the backend call, the settle
//! step, the read-back, the `ActionReport`, the receipt, and one audit line per side effect.
//! There is no retry anywhere in it.

mod binding;
mod call;
mod diagnostics;
mod funnel;
mod memory_markers;
mod poison;
mod record;
mod recovery;
mod report;
mod route;

#[cfg(test)]
mod tests;

pub use binding::{Binding, SecureInputProbe, SecureProbe};
pub use call::Mutation;
pub use memory_markers::MemoryMarkers;
pub(crate) use route::{key_event, route_for};

use std::path::{Path, PathBuf};

use omo_computer_core::backend::{Delivered, Refusal};
use omo_computer_core::intervention::{Pause, TargetLiveness};
use omo_computer_core::session_state::SessionState;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::paths::Roots;
use omo_computer_core::report::Disposition;
use serde_json::Value;

use crate::audit::gc::{ArtifactStore, GcLimits};
use crate::audit::{AuditLimits, AuditSink, AuditWriter, MemoryAudit, UnavailableAudit, WriterId};
use crate::budget::Permits;
use crate::lock::InteractionLock;
use crate::marker::{MarkerDir, MarkerStore};
use crate::Session;
use poison::Poisoned;

/// A marker that cannot be persisted: the input is not sent.
pub const MARKER_UNAVAILABLE: Refusal = Refusal::new(
    EngineCode::TransactionFailed,
    Reason::MarkerUnavailable.wire(),
);
/// A marker of this `(issuer, scope)` is outstanding: completion of that call is unknown.
pub const RECOVERY_REQUIRED: Refusal = Refusal::new(
    EngineCode::TransactionFailed,
    Reason::RecoveryRequired.wire(),
);
/// The `callId` already completed: its stored receipt answers, nothing is sent.
pub const REPLAYED: Refusal = Refusal::new(EngineCode::TransactionFailed, Reason::Replayed.wire());
/// The interaction lock could not be taken.
pub const TRANSACTION_FAILED: Refusal = Refusal::bare(EngineCode::TransactionFailed);

/// The hand id of a local engine.
pub const LOCAL_HAND: &str = "local";

/// A refusal and what the funnel adds to it on the wire: the `callId` it concerns, the
/// stored receipt of a replay, and the disposition of an interrupted earlier send.
#[derive(Debug, Clone, PartialEq)]
pub struct Refused {
    pub refusal: Refusal,
    pub call_id: Option<String>,
    pub receipt: Option<Box<Value>>,
    pub interrupted: Option<Disposition>,
    /// The members a consent or lease refusal carries on the wire (`app`, `identity`,
    /// `window`, `holder`, `retryAfterMs`).
    pub detail: Option<Box<Value>>,
    /// What row 22 stamps on a refusal, boxed so the error type stays small.
    pub stamps: Box<Stamps>,
    /// `write_failed` when the refusal's own audit line could not be written.
    pub warning: Option<String>,
}

/// The members a refusal carries beside its code.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stamps {
    /// Object mode: the units sent before an interrupted send stopped.
    pub delivered: Option<Delivered>,
    /// What the admission waited for before it refused or the send stopped.
    pub paused: Vec<Pause>,
    /// Object mode: the session state sampled for the call.
    pub session: Option<SessionState>,
    /// The target that exited or stopped answering.
    pub target: Option<TargetLiveness>,
}

impl From<Refusal> for Refused {
    fn from(refusal: Refusal) -> Self {
        Self {
            refusal,
            call_id: None,
            receipt: None,
            interrupted: None,
            stamps: Box::default(),
            detail: None,
            warning: None,
        }
    }
}

impl Refused {
    #[must_use]
    pub fn with_paused(mut self, paused: Vec<Pause>) -> Self {
        self.stamps.paused = paused;
        self
    }
}

enum AuditSpec {
    Memory,
    Dir(PathBuf),
}

/// The funnel's state in one session.
pub(crate) struct Funnel {
    binding: Binding,
    generation: u64,
    session_id: String,
    markers: Box<dyn MarkerStore>,
    poisoned: Poisoned,
    audit_spec: AuditSpec,
    audit: Option<Box<dyn AuditSink>>,
    lock: Option<InteractionLock>,
    permits: Permits,
    artifacts: Option<ArtifactStore>,
    secure: Box<dyn SecureProbe>,
    pub(crate) control: crate::grant::Control,
    #[cfg(test)]
    warned: Vec<String>,
}

impl Funnel {
    pub(crate) fn in_memory() -> Self {
        Self::with(
            (Box::new(MemoryMarkers::default()), Poisoned::default()),
            AuditSpec::Memory,
            None,
            None,
        )
    }

    /// Markers and the interaction lock under the RUNTIME root; audit and artifacts under the
    /// STATE root.
    pub(crate) fn for_roots(roots: &Roots) -> Self {
        let artifacts = ArtifactStore::new(roots.state.join("artifacts"), GcLimits::default());
        let mut funnel = Self::with(
            (
                Box::new(MarkerDir::under(&roots.runtime)),
                Poisoned::under(&roots.runtime),
            ),
            AuditSpec::Dir(roots.state.join("audit")),
            Some(InteractionLock::under(&roots.runtime)),
            Some(artifacts),
        );
        funnel.control.runtime = Some(roots.runtime.clone());
        funnel
    }

    fn with(
        (markers, poisoned): (Box<dyn MarkerStore>, Poisoned),
        audit_spec: AuditSpec,
        lock: Option<InteractionLock>,
        artifacts: Option<ArtifactStore>,
    ) -> Self {
        Self {
            binding: Binding::default(),
            generation: 1,
            session_id: String::new(),
            markers,
            poisoned,
            audit_spec,
            audit: None,
            lock,
            permits: Permits::default(),
            artifacts,
            secure: Box::new(SecureInputProbe),
            control: crate::grant::Control::default(),
            #[cfg(test)]
            warned: Vec::new(),
        }
    }

    /// The audit sink, opened at first use; a file that cannot be opened refuses every exec.
    fn audit(&mut self) -> &mut dyn AuditSink {
        let sink = match self.audit.take() {
            Some(sink) => sink,
            None => self.open_audit(),
        };
        self.audit.insert(sink).as_mut()
    }

    /// The per-hand audit writer; one that cannot be opened is logged and refuses every exec.
    fn open_audit(&mut self) -> Box<dyn AuditSink> {
        let dir = match &self.audit_spec {
            AuditSpec::Memory => return Box::new(MemoryAudit::new(LOCAL_HAND, self.generation)),
            AuditSpec::Dir(dir) => dir.clone(),
        };
        let opened = AuditWriter::open(
            &dir,
            LOCAL_HAND,
            self.generation,
            WriterId::current(),
            AuditLimits::default(),
        );
        match opened {
            Ok(writer) => Box::new(writer),
            Err(error) => {
                self.warn(format!(
                    "audit file not opened, every exec refuses: {error}"
                ));
                Box::new(UnavailableAudit::at(crate::audit::audit_path(
                    &dir, LOCAL_HAND,
                )))
            }
        }
    }

    pub(crate) fn set_session_id(&mut self, id: String) {
        self.session_id = id;
    }

    /// The sweep a trigger runs, when the session keeps artifacts.
    pub(crate) fn sweep(&mut self, trigger: crate::audit::gc::SweepTrigger) {
        if let Some(store) = self.artifacts.as_mut() {
            store.sweep(crate::audit::now_ms(), trigger);
        }
    }
}

impl Session {
    /// The `hello.generation` this engine acts under (a marker from another one is a restart).
    #[must_use]
    pub fn with_generation(mut self, generation: u64) -> Self {
        self.funnel.generation = generation;
        self
    }

    #[must_use]
    pub fn with_secure_probe(mut self, probe: Box<dyn SecureProbe>) -> Self {
        self.funnel.secure = probe;
        self
    }

    #[must_use]
    pub fn with_binding(mut self, binding: Binding) -> Self {
        self.funnel.binding = binding;
        self
    }

    pub(crate) fn funnel_issuer(&self) -> String {
        self.funnel.binding.issuer.clone()
    }

    /// The per-hand audit file, once the first exec opened it.
    #[must_use]
    pub fn audit_path(&self) -> Option<&Path> {
        self.funnel.audit.as_ref().and_then(|audit| audit.path())
    }

    /// The artifact dir of the hand, when the session has a STATE root.
    pub fn artifacts(&mut self) -> Option<&mut ArtifactStore> {
        self.funnel.artifacts.as_mut()
    }
}
