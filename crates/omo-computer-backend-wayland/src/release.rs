//! What SP-W's release-on-close proof admits (d-linux.md 'Emulation', RELEASE ON ENGINE DEATH).
//! The degrade has two named states: UNPROVEN (the row has not run for this compositor) refuses
//! only the explicit holds; CONTRADICTS (measured: nothing is released when the engine's socket
//! closes) refuses every verb that holds a key or button for any interval, keeps reads and the
//! action verbs, and reads `backgroundReach:"ax_only"`.

use omo_computer_core::backend::{InputEvent, Refusal};
use omo_computer_core::capabilities::{ReleaseHelper, ReleaseHelperReason};
use omo_computer_core::error::{EngineCode, Reason};

use crate::ledger::ReleaseProof;

/// How a verb uses input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbKind {
    /// `key.down` / `mouse.down`.
    Hold,
    /// `press`, `type`, `click`, `drag`, `scroll`, `mouse.*` on libei: each holds a key or a
    /// button for some interval.
    HoldingInput,
    /// `el.click`, `el.perform`, `el.press` through AT-SPI, `setValue`, a clipboard paste.
    AxAction,
    Read,
}

impl VerbKind {
    /// The fixtures' spelling.
    #[must_use]
    pub fn from_wire(kind: &str) -> Option<Self> {
        match kind {
            "hold" => Some(Self::Hold),
            "holding_input" => Some(Self::HoldingInput),
            "ax_action" => Some(Self::AxAction),
            "read" => Some(Self::Read),
            _ => None,
        }
    }

    /// The kind of one libei event: every one holds something for an interval, or moves the
    /// pointer of a seat that may hold a button.
    #[must_use]
    pub const fn of_event(event: &InputEvent) -> Self {
        match event {
            InputEvent::PointerMove(_)
            | InputEvent::Button { .. }
            | InputEvent::Key { .. }
            | InputEvent::Scroll { .. }
            | InputEvent::Text(_) => Self::HoldingInput,
            InputEvent::MenuSelect { .. }
            | InputEvent::AppLaunch { .. }
            | InputEvent::AppQuit { .. }
            | InputEvent::OpenSurface { .. } => Self::AxAction,
        }
    }
}

/// The action route a refused holding verb is pointed at.
const fn next_call(event: Option<&InputEvent>) -> &'static str {
    match event {
        Some(
            InputEvent::PointerMove(_) | InputEvent::Button { .. } | InputEvent::Scroll { .. },
        ) => "el.click()",
        _ => "el.setValue(text)",
    }
}

fn refused(next: Option<&'static str>) -> Refusal {
    let refusal = Refusal::new(
        EngineCode::StopPathUnavailable,
        Reason::ReleaseHelperUnavailable,
    );
    match next {
        Some(next) => refusal.with_data(serde_json::json!({ "nextCall": next })),
        None => refusal,
    }
}

/// Admits `verb` under `proof`, before any libei frame.
///
/// # Errors
/// `StopPathUnavailable{release_helper_unavailable}` with nothing sent; under CONTRADICTS it
/// names the action route as `nextCall`.
pub fn admit(proof: ReleaseProof, verb: VerbKind) -> Result<(), Refusal> {
    admit_event(proof, verb, None)
}

/// [`admit`] for one event the backend is about to send.
///
/// # Errors
/// As [`admit`].
pub fn admit_event(
    proof: ReleaseProof,
    verb: VerbKind,
    event: Option<&InputEvent>,
) -> Result<(), Refusal> {
    match (proof, verb) {
        (ReleaseProof::Confirmed, _)
        | (_, VerbKind::AxAction | VerbKind::Read)
        | (ReleaseProof::Unproven, VerbKind::HoldingInput) => Ok(()),
        (ReleaseProof::Unproven, VerbKind::Hold) => Err(refused(None)),
        (ReleaseProof::Contradicts, VerbKind::Hold | VerbKind::HoldingInput) => {
            Err(refused(Some(next_call(event))))
        }
    }
}

/// `capabilities().releaseHelper` on the libei route: the helper holds no EIS connection, so it
/// is available exactly when the compositor's release on socket close is measured.
#[must_use]
pub const fn capability(proof: ReleaseProof) -> ReleaseHelper {
    match proof {
        ReleaseProof::Confirmed => ReleaseHelper {
            available: true,
            reason: None,
        },
        ReleaseProof::Unproven | ReleaseProof::Contradicts => ReleaseHelper {
            available: false,
            reason: Some(ReleaseHelperReason::WaylandReleaseUnproven),
        },
    }
}
