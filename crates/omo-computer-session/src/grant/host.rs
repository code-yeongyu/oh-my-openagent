//! The host-only verbs of the grant and the lease: `control.grant` / `control.revoke` /
//! `control.acquire` / `control.release`, `display.release` / `display.resume`,
//! `preview.subscribe`, and the host's consent events (a denied prompt, the per-app stop, a newer
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
use crate::preview::{Dropped, PreviewFrame};
use omo_computer_core::backend::FrameBytes;
use crate::{Session, NOT_OPEN};

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
        self.funnel.control.slot.acquire(&self.funnel.control.token).map_err(|holder| busy(&holder))?;
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
        let backend = &mut self.backend;
        self.guard.observe(&mut || backend.stop_listener(), &mut omo_computer_safety::NoHolds);
        let epoch = self.guard.supervisor().stop_epoch();
        self.funnel.control.grant.reconcile(epoch);
        if self.funnel.control.lease_epoch.is_some_and(|taken| taken != epoch) {
            self.end_lease(LeaseEnd::Stop);
        }
    }

    /// The lease ends under the user (the next report reads `user_moved_on`, no `Suspended`).
    pub(crate) fn end_lease(&mut self, why: LeaseEnd) {
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

    pub fn preview_subscribe(&mut self) {
        self.funnel.control.preview.subscribe();
    }

    /// A captured frame for the preview lane; emitted only to a subscriber during a lease.
    ///
    /// # Errors
    /// Why the frame was dropped.
    pub fn offer_preview(&mut self, frame: FrameBytes) -> Result<(), Dropped> {
        let now = self.funnel.control.now_ms();
        let lease = self.holds_lease();
        self.funnel.control.preview.offer(now, lease, frame)
    }

    /// The frames for the host's `preview.frame` notifications.
    pub fn take_preview_frames(&mut self) -> Vec<PreviewFrame> {
        self.funnel.control.preview.drain()
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
        let mut view = raw.clone().map(ConsentView::from_host).unwrap_or_default();
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
        self.funnel.control.consent = Consent::new(view, LOCAL_HAND, Os::host());
        Ok(())
    }

    /// `session.open` after the gate: the session id, the consent view and the session token.
    pub(crate) fn open_control(&mut self, session_id: &str, stop_hotkey: Option<&str>) -> Result<(), Refusal> {
        self.funnel.set_session_id(session_id.to_owned());
        self.open_consent()?;
        self.refuse_carried_chord(stop_hotkey)?;
        self.mint_token(session_id)
    }

    /// A-IS-62 rev 5: a chord carried by `session.open{settings}` or `stopPath.start` is compared
    /// with the configured one through the one parser; a differing or unparseable chord refuses the
    /// call (one audit line naming both chords) and leaves the hand tampered (R70an C).
    /// R70as(3): where the engine cannot read the configured chord nothing is compared or armed;
    /// the call is refused (the deaf chord-unarmable reading is row 50's or the LEAD's).
    ///
    /// # Errors
    /// `ControlRequired{tampered}` when the view did not carry stopHotkey.
    pub(crate) fn refuse_unreadable_chord(&self) -> Result<(), Refusal> {
        let os = backend_os(self.backend.as_ref());
        match self.funnel.control.consent.view().stop_chord(os) {
            crate::consent::StopChord::Unreadable => Err(Refusal::new(
                omo_computer_core::error::EngineCode::ControlRequired,
                omo_computer_core::error::Reason::Tampered.wire(),
            )),
            _ => Ok(()),
        }
    }

    pub(crate) fn refuse_carried_chord(&mut self, stop_hotkey: Option<&str>) -> Result<(), Refusal> {
        let os = backend_os(self.backend.as_ref());
        let view = self.funnel.control.consent.view();
        let configured = match view.stop_chord(os) {
            crate::consent::StopChord::Chord(chord) | crate::consent::StopChord::Unparseable(chord) => chord,
            crate::consent::StopChord::Unreadable => "unreadable".to_owned(),
        };
        if let Err(refusal) = check_stop_hotkey(view, os, stop_hotkey) {
            // One audit line for the refused call, naming both chords; the hand then reads
            // tampered at once (A-IS-62 rev 5, R70an C, reversing R70aj). The peer's pid and executable
            // are owed by row 29's peer check.
            let _ = self.funnel.audit().append(crate::audit::AuditEvent {
                action: "session.open".to_owned(),
                target: "stop_hotkey".to_owned(),
                gate: crate::audit::Gate {
                    outcome: crate::audit::GateOutcome::Refused,
                    stage: Some("Consent".to_owned()),
                    code: Some(refusal.code.wire().to_owned()),
                    reason: refusal.reason.map(str::to_owned),
                },
                status: crate::audit::Status::Refused,
                primary_error: Some(refusal.code.wire().to_owned()),
                evidence: vec![
                    format!("configured={configured}"),
                    format!("carried={}", stop_hotkey.unwrap_or_default()),
                ],
                ..crate::audit::AuditEvent::default()
            });
            // The hand now reads tampered until the consent is re-saved (A-IS-62 rev 5, R70an C).
            let raw = self.backend.host_consent();
            self.funnel.control.chord_tamper.refused(raw.as_ref());
            self.open_consent()?;
            return Err(refusal);
        }
        Ok(())
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
        self.funnel.control.reservations.release_all(&self.funnel.control.token);
    }
}

/// A-IS-62: the stop chord has ONE source, the consent file's `stopHotkey`. A `stop_hotkey` in
/// `session.open{settings}` that differs from it is refused before anything is armed.
///
/// # Errors
/// The pin's `ControlRequired{permission_changed, tampered}` (d-sdk-skill.md:516, d-safety.md:335),
/// encoded as the tampered-file refusal is today: `ControlRequired{reason:"tampered"}` (R70aj; the
/// `permission_changed` marker rides the wire with row 27's data member). An unparseable file chord
/// equals nothing, so any requested chord differs.
fn check_stop_hotkey(view: &ConsentView, os: Os, requested: Option<&str>) -> Result<(), Refusal> {
    let Some(requested) = requested else {
        return Ok(());
    };
    if view.same_stop_chord(os, requested) {
        Ok(())
    } else {
        Err(Refusal::new(
            omo_computer_core::error::EngineCode::ControlRequired,
            omo_computer_core::error::Reason::Tampered.wire(),
        ))
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
