//! The human-confirmed foreground control grant.
//!
//! Foreground delivery moves the user's focus and cursor, so the engine only
//! admits it while this session holds a live [`ControlGrant`], granted by the
//! host after the user confirmed (`control.grant`, host-only). At most one
//! session of the process holds the slot; a second session's grant is refused
//! `InputBusy`, never stolen. `control.revoke`, `session.close`, and a stop
//! (the supervisor's stop epoch, checked at admission and reconciled at the
//! next served request) each release the grant; a grant is refused while the
//! stop is latched, and `stopPath.resume` never restores one. Requests run on
//! one serial queue, so nothing queued before a revoke runs after it; the
//! fence against a late human "yes" lives in the host (B5b).
//! The grant authorizes foreground only; an omitted delivery stays
//! background. `raiseWindow` needs the grant too: raising a window takes the
//! user's foreground, the most visible focus steal of all. This is
//! deliberately stricter than upstream, which gates only `takeover` input.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::ControlGrantParams;
use senpi_desktop_core::protocol_results::ControlStateResult;
use senpi_desktop_safety::MutatingAction;

use crate::request::Response;
use crate::worker::Worker;

/// The next grant generation; revocation bumps it by freeing the slot.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
/// The next per-Worker instance id, identifying a slot owner.
static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

/// A fresh slot-owner id for one session worker.
pub(crate) fn next_instance() -> u64 {
    NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed)
}

/// One live grant, as the slot and the session worker see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ControlGrant {
    pub(crate) id: String,
    pub(crate) reason: String,
    pub(crate) generation: u64,
    pub(crate) granted_at: String,
    /// The supervisor stop epoch at grant time; a stop revokes the grant.
    pub(crate) stop_epoch: u64,
}

/// Who the slot belongs to right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SlotOwner {
    instance: u64,
    generation: u64,
}

/// The foreground-control slot: at most one session holds it, and a second
/// session's grant is refused, never stolen. The engine shares one per
/// process ([`ControlSlot::process_wide`]); tests give each harness its own,
/// so parallel tests never contend for a global.
#[derive(Debug, Default)]
pub struct ControlSlot {
    owner: Mutex<Option<SlotOwner>>,
}

impl ControlSlot {
    /// A fresh, unowned slot.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// The one slot every session of this process shares.
    #[must_use]
    pub fn process_wide() -> Arc<Self> {
        static SLOT: OnceLock<Arc<ControlSlot>> = OnceLock::new();
        Arc::clone(SLOT.get_or_init(ControlSlot::new))
    }
}

impl Worker {
    /// How many stops the supervisor has seen; a grant from an earlier epoch
    /// was revoked by a stop.
    pub(crate) fn stop_epoch(&self) -> u64 {
        self.safety.supervisor.stop_epoch()
    }
}

/// Foreground delivery is admitted only while this worker holds a live grant
/// that no stop has revoked since it was granted.
pub(crate) fn admits(delivery: DeliveryMode, live: bool) -> bool {
    delivery == DeliveryMode::Background || live
}

impl Worker {
    /// Refuses a foreground mutation without this session's live grant whose
    /// stop epoch is still current. Runs after the fail-closed gate and before
    /// any capture or backend call; the refusal is audited like any other.
    pub(crate) fn admit_control(&self, mutation: &crate::mutate::Mutation<'_>) -> CoreResult<()> {
        let live = self
            .control
            .as_ref()
            .is_some_and(|grant| grant.stop_epoch == self.stop_epoch());
        if admits(mutation.delivery, live) {
            return Ok(());
        }
        if mutation.action == MutatingAction::RaiseWindow {
            return Err(DesktopError::control_required(
                "raising a window takes your foreground: approve the grant to allow it \
                 (computer.control.acquire asks the human first)",
            ));
        }
        Err(DesktopError::control_required(
            "foreground delivery needs this session's live control grant; the host shows the human \
             the reason and calls control.grant first (background delivery needs no grant)",
        ))
    }
}

impl Worker {
    /// `control.grant`: takes the slot for this session. A
    /// second session is refused `InputBusy` and never steals it; the same
    /// session re-grants with a fresh generation.
    pub(crate) fn try_grant(&mut self, params: &ControlGrantParams) -> CoreResult<ControlStateResult> {
        // A confirm answered as the user hits the stop chord must not grant:
        // the grant would record the post-stop epoch and survive resume. The
        // epoch is read first: a stop bumps it before latching suspension, so
        // a stop landing after this read leaves the grant with a stale epoch.
        let stop_epoch = self.stop_epoch();
        if self.safety.supervisor.is_suspended() {
            return Err(DesktopError::from(senpi_desktop_safety::GateError::Suspended));
        }
        let mut slot = self.safety.control_slot.owner.lock();
        if let Some(owner) = slot.as_ref() {
            if owner.instance != self.instance {
                return Err(DesktopError::input_busy(
                    "another session holds the foreground control grant; it is never stolen, so retry \
                     after that session revokes or closes",
                ));
            }
        }
        let generation = NEXT_GENERATION.fetch_add(1, Ordering::SeqCst);
        let grant = ControlGrant {
            id: ulid::Ulid::generate().to_string(),
            reason: params.reason.clone(),
            generation,
            granted_at: crate::audit::rfc3339_ms(crate::audit::unix_now_ms()),
            stop_epoch,
        };
        *slot = Some(SlotOwner {
            instance: self.instance,
            generation,
        });
        let state = ControlStateResult {
            active: true,
            reason: Some(grant.reason.clone()),
            granted_at: Some(grant.granted_at.clone()),
        };
        self.control = Some(grant);
        Ok(state)
    }

    /// `control.revoke`: idempotent; frees the slot this session owns.
    pub(crate) fn try_revoke(&mut self) -> CoreResult<()> {
        self.release_control();
        Ok(())
    }

    /// Releases this worker's slot share: `session.close` and `Drop`. Not an
    /// audit event: `session.close` and the stop revocation have their own.
    pub(crate) fn release_control(&mut self) {
        let mut slot = self.safety.control_slot.owner.lock();
        if slot.as_ref().is_some_and(|owner| owner.instance == self.instance) {
            *slot = None;
        }
        drop(slot);
        self.control = None;
    }

    /// Drops the grant when a stop was observed since it was granted. Runs at
    /// the top of every served request, so a suspension revokes even when no
    /// mutating op follows, and `stopPath.resume` never restores it.
    pub(crate) fn reconcile_grant(&mut self) {
        let revoked = self
            .control
            .as_ref()
            .is_some_and(|grant| grant.stop_epoch != self.stop_epoch());
        if revoked {
            self.release_control();
        }
    }

    /// This worker's live grant as the `control.state` reply.
    pub(crate) fn control_state(&self) -> ControlStateResult {
        match self.control.as_ref() {
            Some(grant) => ControlStateResult {
                active: true,
                reason: Some(grant.reason.clone()),
                granted_at: Some(grant.granted_at.clone()),
            },
            None => ControlStateResult {
                active: false,
                reason: None,
                granted_at: None,
            },
        }
    }
}

impl Worker {
    /// `control.grant`: exactly one audit event names the outcome; the
    /// reason is hashed, never logged.
    pub(crate) fn control_grant(&mut self, params: &ControlGrantParams) -> CoreResult<Response> {
        let result = self.try_grant(params);
        let event = crate::audit::control_audit(
            Method::ControlGrant,
            Some(params.reason.as_str()),
            result.as_ref().err().map(|error| error.code),
        );
        (self.safety.audit)(&event);
        self.persist_audit(&event, result.as_ref().err());
        result.map(Response::ControlState)
    }

    /// `control.revoke`: idempotent, exactly one audit event.
    pub(crate) fn control_revoke(&mut self) -> CoreResult<Response> {
        let result = self.try_revoke();
        let event = crate::audit::control_audit(
            Method::ControlRevoke,
            None,
            result.as_ref().err().map(|error| error.code),
        );
        (self.safety.audit)(&event);
        self.persist_audit(&event, result.as_ref().err());
        result.map(|()| Response::Unit)
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.release_control();
    }
}

#[cfg(test)]
mod tests;
