//! Arming and validating the stop chord carried by a host session.

use omo_computer_core::backend::Refusal;
use omo_computer_safety::protected::Os;

use super::backend_os;
use crate::consent::ConsentView;
use crate::Session;

impl Session {
    /// A-IS-62 rev 5: a chord carried by `session.open{settings}` or `stopPath.start` is compared
    /// with the configured one through the one parser; a differing or unparseable chord refuses the
    /// call (one audit line naming both chords) and leaves the hand tampered (R70an C).
    /// The configured chord as armed: its parsed spelling, or `None` when it cannot be armed.
    fn configured_chord(&self) -> Option<String> {
        match self.funnel.control.consent.view().stop_chord(backend_os(self.backend.as_ref())) {
            crate::consent::StopChord::Chord(chord) => Some(chord),
            crate::consent::StopChord::Unparseable(_) | crate::consent::StopChord::Unreadable => None,
        }
    }

    /// Arms the configured chord (R70av), or a deaf listener when it cannot be read or parsed: the
    /// stop path then reads deaf at once, never live or stale.
    pub(crate) fn arm_configured_chord(&mut self) -> omo_computer_core::results::StopPathStatus {
        if let Some(chord) = self.configured_chord() {
            // R70av: the one chord seam; a chord the backend cannot arm reads deaf at once.
            if self.backend.set_stop_chord(Some(&chord)).is_ok() {
                self.funnel.control.armed_chord = Some(chord);
                return self.guard.start_on(self.backend.as_mut());
            }
        }
        self.funnel.control.armed_chord = Some(String::new());
        self.guard.start(
            Err(Refusal::new(
                omo_computer_core::error::EngineCode::StopPathUnavailable,
                omo_computer_core::error::Reason::Deaf,
            )),
            None,
        )
    }

    /// R70av: before an exec is admitted, a stop key changed since it was armed re-arms the listener.
    pub(super) fn rearm_on_changed_chord(&mut self) {
        let Some(armed) = self.funnel.control.armed_chord.clone() else {
            return;
        };
        if self.configured_chord().unwrap_or_default() != armed {
            self.arm_configured_chord();
        }
    }

    /// R70as(3): where the engine cannot read the configured chord nothing is compared or armed;
    /// the call is refused (the deaf chord-unarmable reading is row 50's or the LEAD's).
    ///
    /// # Errors
    /// `ControlRequired{tampered}` when the view did not carry stopHotkey.
    pub(crate) fn refuse_unreadable_chord(&mut self) -> Result<(), Refusal> {
        if self.configured_chord().is_some() {
            return Ok(());
        }
        // R70au(3): the listener arms no chord and reads deaf; the call answers StopPathUnavailable{deaf}.
        self.arm_configured_chord();
        Err(Refusal::new(
            omo_computer_core::error::EngineCode::StopPathUnavailable,
            omo_computer_core::error::Reason::Deaf,
        ))
    }

    pub(crate) fn refuse_carried_chord(&mut self, stop_hotkey: Option<&str>, call: &str) -> Result<(), Refusal> {
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
                action: call.to_owned(),
                target: "stop_hotkey".to_owned(),
                gate: crate::audit::Gate {
                    outcome: crate::audit::GateOutcome::Refused,
                    stage: Some("Consent".to_owned()),
                    code: Some(refusal.code.wire().to_owned()),
                    reason: refusal.reason.map(|reason| reason.wire().to_owned()),
                },
                status: crate::audit::Status::Refused,
                primary_error: Some(refusal.code.wire().to_owned()),
                evidence: vec![
                    format!("configured={}", cut_chord(&configured)),
                    format!("carried={}", cut_chord(stop_hotkey.unwrap_or_default())),
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
    // A-IS-62 rev 7: a carried chord longer than 256 bytes differs; it is never cut and compared.
    if requested.len() <= MAX_CHORD_BYTES && view.same_stop_chord(os, requested) {
        Ok(())
    } else {
        Err(Refusal::new(
            omo_computer_core::error::EngineCode::ControlRequired,
            omo_computer_core::error::Reason::Tampered,
        ))
    }
}

/// A-IS-62 rev 7: the longest chord compared or written; a peer-supplied chord cannot grow the line.
const MAX_CHORD_BYTES: usize = 256;

/// The first 256 bytes of a chord for the audit line (on a char boundary).
fn cut_chord(chord: &str) -> &str {
    let mut end = chord.len().min(MAX_CHORD_BYTES);
    while !chord.is_char_boundary(end) {
        end -= 1;
    }
    &chord[..end]
}
