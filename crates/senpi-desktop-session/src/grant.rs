//! The human-confirmed foreground control grant.
//!
//! Foreground delivery moves the user's focus and cursor, so the engine only
//! admits it while this session holds a live [`ControlGrant`], granted by the
//! host after the user confirmed (`control.grant`, host-only). At most one
//! session of the process holds the slot; a second session's grant is refused
//! `InputBusy`, never stolen. `control.revoke`, `session.close`, and a stop
//! (observed at the next served request through the supervisor's stop epoch)
//! each release the grant; `stopPath.resume` never restores it. A mutation
//! queued under one grant runs under no other: the grant generation captured
//! when the request was enqueued must still be the live grant at admission.
//! The grant authorizes foreground only; an omitted delivery stays
//! background. `raiseWindow` is exempt because the call is itself the asked
//! focus change (upstream gates only `takeover` input).

use std::sync::atomic::{AtomicU64, Ordering};

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

/// Who the process-wide slot belongs to right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SlotOwner {
    instance: u64,
    generation: u64,
}

static CONTROL_SLOT: Mutex<Option<SlotOwner>> = parking_lot::const_mutex(None);

/// The owner's current generation, captured when a request is enqueued.
pub(crate) fn generation_for(instance: u64) -> Option<u64> {
    CONTROL_SLOT
        .lock()
        .as_ref()
        .filter(|owner| owner.instance == instance)
        .map(|owner| owner.generation)
}

impl Worker {
    /// Serializes the request's slot check with the grant's stop epoch.
    pub(crate) fn stop_epoch(&self) -> u64 {
        self.safety.supervisor.stop_epoch()
    }
}

/// A mutation queued under `queued` (the slot generation at dequeue time)
/// may deliver to the foreground only when that generation is this worker's
/// live grant. `raiseWindow` is the asked focus change itself and needs none.
pub(crate) fn admits(action: MutatingAction, delivery: DeliveryMode, queued: Option<u64>, live: Option<u64>) -> bool {
    if action == MutatingAction::RaiseWindow || delivery == DeliveryMode::Background {
        return true;
    }
    live.is_some() && queued == live
}

impl Worker {
    /// The live grant's generation, when this worker holds the slot.
    pub(crate) fn live_generation(&self) -> Option<u64> {
        self.control.as_ref().map(|grant| grant.generation)
    }
}

impl Worker {
    /// Refuses a foreground mutation whose queued generation is not this
    /// worker's live grant, before the gate or any backend call. The
    /// admission error is audited like any other refusal.
    pub(crate) fn admit_control(&self, mutation: &crate::mutate::Mutation<'_>) -> CoreResult<()> {
        if admits(
            mutation.action,
            mutation.delivery,
            self.queued_generation,
            self.live_generation(),
        ) {
            return Ok(());
        }
        Err(DesktopError::control_required(format!(
            "foreground delivery needs this session's live control grant; the host shows the human \
             the reason and calls control.grant first (background delivery needs no grant)"
        )))
    }
}

impl Worker {
    /// `control.grant`: takes the process-wide slot for this session. A
    /// second session is refused `InputBusy` and never steals it; the same
    /// session re-grants with a fresh generation.
    pub(crate) fn try_grant(&mut self, params: &ControlGrantParams) -> CoreResult<ControlStateResult> {
        let mut slot = CONTROL_SLOT.lock();
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
            stop_epoch: self.stop_epoch(),
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

    /// `control.revoke`: idempotent; frees the slot this session owns. Every
    /// revocation is a generation boundary: nothing queued under the old
    /// generation runs under the next grant.
    pub(crate) fn try_revoke(&mut self) -> CoreResult<()> {
        self.release_control();
        Ok(())
    }

    /// Releases this worker's slot share: `session.close` and `Drop`. Not an
    /// audit event: `session.close` and the stop revocation have their own.
    pub(crate) fn release_control(&mut self) {
        let mut slot = CONTROL_SLOT.lock();
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
pub(crate) fn test_lock() -> &'static Mutex<()> {
    static LOCK: Mutex<()> = parking_lot::const_mutex(());
    &LOCK
}

#[cfg(test)]
mod tests;
