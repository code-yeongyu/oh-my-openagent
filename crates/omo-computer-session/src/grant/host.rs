//! The host-only verbs of the grant and the lease: `control.grant` / `control.revoke` /
//! `control.acquire` / `control.release`, `display.release` / `display.resume`,
//! and the host's consent events (a denied prompt, the per-app stop, a newer
//! user message, a re-approval). None of them is model-callable.

use omo_computer_core::backend::Refusal;
use omo_computer_core::methods::Method;
use omo_computer_core::params::ControlGrantParams;
use omo_computer_core::results::{ControlState, StopPathStatus};
use omo_computer_safety::gate::verdicts::LeaseRefusal;

use super::state::{holder_detail, MachineClock};
use omo_computer_safety::protected::Os;

use crate::consent::{bind_scope, AppTarget, Consent, ConsentView, Part};
use crate::mutate::LOCAL_HAND;
use crate::lease::{Holder, SessionToken};
use crate::mutate::Refused;
use crate::presence::LeaseEnd;
use crate::{Session, NOT_OPEN};

mod stop_chord;

impl Session {
    /// Every session of a test machine reads `clock` for reservations.
    #[must_use]
    pub fn with_clock(mut self, clock: MachineClock) -> Self {
        self.funnel.control.clock = clock;
        self
    }

    #[must_use]
    pub const fn consent(&self) -> &Consent {
        &self.funnel.control.consent
    }

    /// The host's prompt for `part` was denied: not asked again until a newer user message.
    pub fn record_denial(&mut self, part: Part, app: Option<&AppTarget>) {
        self.funnel.control.consent.record_denial(part, app);
    }

    /// "Stop computer use in <app>": that app leaves the scope; nothing is latched.
    pub fn stop_app(&mut self, app: &AppTarget) {
        self.funnel.control.consent.stop_app(app);
    }

    pub fn approve_app(&mut self, app: &AppTarget) {
        self.funnel.control.consent.approve_app(app);
    }

    pub fn user_message(&mut self) {
        self.funnel.control.consent.user_message();
    }

    /// `control.grant{reason, confirmationId}`: the human grant under the current stop epoch.
    pub fn control_grant(&mut self, params: ControlGrantParams) -> ControlState {
        let ControlGrantParams {
            reason,
            confirmation_id,
        } = params;
        let epoch = self.guard.supervisor().stop_epoch();
        self.funnel.control.grant.grant(confirmation_id, epoch);
        ControlState {
            active: true,
            reason: Some(reason),
            granted_at: None,
        }
    }

    /// `control.revoke`: the grant and any lease end now.
    pub fn control_revoke(&mut self) {
        self.funnel.control.grant.revoke();
        self.control_release();
    }

    /// `control.acquire`: takes the machine's foreground lease under the live grant.
    ///
    /// # Errors
    /// [`NOT_OPEN`]; `ControlRequired` with no grant; `InputBusy{holder}` while any session (this
    /// one included) holds the slot; `PresenceUnavailable` with no presence surface.
    pub fn control_acquire(&mut self) -> Result<ControlState, Refused> {
        if self.opened.is_none() {
            return Err(NOT_OPEN.into());
        }
        self.reconcile_stop();
        let epoch = self.guard.supervisor().stop_epoch();
        // A latched stop refuses every input; the lease is not taken for input that cannot run.
        if let Some(latch) = self.guard.supervisor().latch() {
            return Err(latch.refusal().into());
        }
        // Review L7: the hand's consent as the exec path checks it - a tampered hand, a view that
        // does not carry its stop chord (R6-1: no consent file read) or computer use off never
        // takes the foreground slot.
        self.funnel
            .control
            .consent
            .admit_exec(None)
            .map_err(|denial| Refused::from(denial.refusal.refusal()))?;
        // The grant's own checks, as a foreground call runs them: `foreground: never`, a remote
        // hand (`headless_host`), then a live grant.
        let control = &self.funnel.control;
        control
            .grant
            .admit(control.consent.view(), (Method::ControlAcquire, None), control.consent.hand())
            .map_err(|refusal| Refused::from(refusal.refusal()))?;
        let busy = |holder: &Holder| Refused {
            detail: Some(Box::new(holder_detail(holder))),
            ..Refused::from(LeaseRefusal::InputBusy.refusal())
        };
        if let Some(holder) = self.funnel.control.slot.holder(&self.funnel.control.token) {
            return Err(busy(&holder));
        }
        // Review L10's second site: a record lock that cannot be taken is TransactionFailed with
        // nothing taken, never InputBusy naming this session.
        self.funnel.control.slot.acquire(&self.funnel.control.token).map_err(|refused| match refused {
            crate::lease::SlotRefusal::Held(holder) => busy(&holder),
            crate::lease::SlotRefusal::LockUnavailable => crate::mutate::TRANSACTION_FAILED.into(),
        })?;
        if let Err(refusal) = self.funnel.control.presence.begin(self.backend.as_mut()) {
            self.funnel.control.slot.release(&self.funnel.control.token);
            return Err(refusal.refusal().into());
        }
        self.funnel.control.lease_epoch = Some(epoch);
        Ok(ControlState {
            active: true,
            reason: None,
            granted_at: None,
        })
    }

    /// `control.release`: this session's lease ends; the grant stays.
    pub fn control_release(&mut self) {
        self.end_lease(LeaseEnd::Release);
    }

    /// A stop the gate's listener poll latched (the hotkey path, never through `stop_control`):
    /// a lease taken under an earlier stop epoch ends through [`Self::end_lease`], once.
    pub(crate) fn reconcile_stop(&mut self) {
        // Review L5: the armed listener is polled FIRST, so a press queued in it is never dropped
        // when a changed chord replaces it; the re-arm follows.
        let backend = &mut self.backend;
        self.guard.observe(&mut || backend.stop_listener(), &mut omo_computer_safety::NoHolds);
        self.rearm_on_changed_chord();
        let epoch = self.guard.supervisor().stop_epoch();
        self.funnel.control.grant.reconcile(epoch);
        if self.funnel.control.lease_epoch.is_some_and(|taken| taken != epoch) {
            self.end_lease(LeaseEnd::Stop);
        }
    }

    /// The lease ends under the user (the next report reads `user_moved_on`, no `Suspended`).
    pub(crate) fn end_lease(&mut self, why: LeaseEnd) {
        self.funnel.control.preview.discard_pending();
        self.funnel.control.presence.end(why);
        self.funnel.control.slot.release(&self.funnel.control.token);
        self.funnel.control.lease_epoch = None;
        self.funnel.control.lease_hook.lease_ended(self.backend.as_mut(), why);
    }

    /// Installs the lease-end hook a later row's state lives in (R45).
    pub fn set_lease_hook(&mut self, hook: Box<dyn super::LeaseHook>) {
        self.funnel.control.lease_hook = hook;
    }

    /// `display.release`: ends the lease and lets the display sleep; the run continues.
    pub fn display_release(&mut self) {
        self.funnel.control.display_released = true;
        self.end_lease(LeaseEnd::DisplayRelease);
    }

    /// `display.resume`: re-arms the display-awake hold only; it restores no lease.
    pub fn display_resume(&mut self) {
        self.funnel.control.display_released = false;
        self.funnel.control.lease_hook.display_resumed(self.backend.as_mut());
    }

    #[must_use]
    pub const fn display_released(&self) -> bool {
        self.funnel.control.display_released
    }

    /// Whether this session holds the machine's foreground lease.
    #[must_use]
    pub fn holds_lease(&self) -> bool {
        self.funnel.control.slot.is_mine(&self.funnel.control.token)
    }

    /// A per-uid session token, under the RUNTIME root when the session has one.
    pub(crate) fn mint_token(&mut self, session_id: &str) -> Result<(), Refusal> {
        let holder = Holder {
            session_id: session_id.to_owned(),
            agent: self.funnel_issuer(),
        };
        self.funnel.control.token = match &self.funnel.control.runtime {
            None => SessionToken::in_memory(holder),
            Some(runtime) => SessionToken::under(runtime, holder)
                .map_err(|_| Refusal::bare(omo_computer_core::error::EngineCode::TransactionFailed))?,
        };
        Ok(())
    }

    /// `session.open`: the host's consent view (narrowed only), its scope bound to app keys, the
    /// allowed denied apps handed to the gate. A scope name that binds to nothing refuses.
    pub(crate) fn open_consent(&mut self) -> Result<(), Refusal> {
        let raw = self.backend.host_consent();
        let mut view = view_of(raw.clone());
        // A-IS-62 rev 5 (R70an C): a refused chord left the hand tampered under this consent.
        if self.funnel.control.chord_tamper.holds(raw.as_ref()) {
            view.tampered = true;
        }
        if let Some(names) = &view.scope {
            let known: Vec<String> = self
                .backend
                .windows(&omo_computer_core::backend::WindowFilter::default())
                .map(|list| list.windows.into_iter().map(|w| w.app_key).collect())
                .unwrap_or_default();
            view.scope = Some(bind_scope(names, &known)?);
        }
        self.guard.set_allowed_apps(view.allowed_keys());
        self.close_control();
        self.funnel.control.grant.revoke();
        // R70al(2): the backend's OS (the fake's persona), never the host's.
        let os = backend_os(self.backend.as_ref());
        self.funnel.control.consent = Consent::new(view, LOCAL_HAND, os);
        Ok(())
    }

    /// `session.open` after the gate: the session id, the consent view and the session token.
    pub(crate) fn open_control(&mut self, session_id: &str, stop_hotkey: Option<&str>) -> Result<(), Refusal> {
        self.funnel.set_session_id(session_id.to_owned());
        self.open_consent()?;
        self.refuse_carried_chord(stop_hotkey, "session.open")?;
        self.mint_token(session_id)
    }

    /// `stopPath.stop`: the grant is revoked and the lease ends (`user_moved_on`, nothing more).
    pub(crate) fn stop_control(&mut self, source: Option<&str>) -> StopPathStatus {
        let status = self.guard.stop(source, &mut omo_computer_safety::NoHolds).1;
        self.funnel.control.grant.revoke();
        self.end_lease(LeaseEnd::Stop);
        status
    }

    /// Session close: the lease, the reservations and the presence surface end.
    pub(crate) fn close_control(&mut self) {
        self.control_release();
        self.funnel.control.preview.end_session();
        self.funnel.control.reservations.release_all(&self.funnel.control.token);
    }
}

/// The OS whose documented defaults apply: the backend's platform, else the host's (R70an A).
pub(crate) fn backend_os(backend: &dyn omo_computer_core::backend::Backend) -> Os {
    use omo_computer_core::report::Platform;
    match backend.platform() {
        Some(Platform::Macos) => Os::Macos,
        Some(Platform::X11 | Platform::Wayland) => Os::Linux,
        Some(Platform::Windows) => Os::Windows,
        None => Os::host(),
    }
}

/// The view a session runs under. A backend that hands NO consent view is a real backend whose
/// engine read no consent file (A-IS-62 rev 6, R6-1): the view is NOT carried - computer:read
/// only, no exec admitted and no chord armed. The fake always hands a view (the code-built default
/// stays for tests and the fake only).
pub(crate) fn view_of(raw: Option<serde_json::Value>) -> ConsentView {
    raw.map_or_else(
        || ConsentView {
            stop_hotkey: None,
            grants: vec!["computer:read".to_owned()],
            ..ConsentView::default()
        },
        ConsentView::from_host,
    )
}

#[cfg(test)]
mod view_of_tests {
    /// R6-1: no consent file read means read-only, no exec and no chord.
    #[test]
    fn a_session_with_no_consent_file_is_read_only_and_arms_no_chord() {
        use omo_computer_safety::protected::Os;
        let view = super::view_of(None);
        assert_eq!(view.stop_chord(Os::Linux), crate::consent::StopChord::Unreadable, "no chord is armed");
        assert_eq!(view.grants, vec!["computer:read".to_owned()], "computer:read only");
        let consent = crate::consent::Consent::new(view, crate::mutate::LOCAL_HAND, Os::Linux);
        assert!(consent.admit_exec(None).is_err(), "no exec is admitted");
        assert_eq!(super::view_of(Some(serde_json::json!({ "stopHotkey": null }))).grants.len(), 2, "a handed view is read as written");
    }
}
