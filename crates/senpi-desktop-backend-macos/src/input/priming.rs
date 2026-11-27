//! Exact-window key priming (DESIGN 7 steps 2-6 and 8): before background
//! keys go to a process that owns several windows, the target window is made
//! that process's key window and proven so by two reads; keys are sent only
//! on that proof, and key focus inside the app is handed back afterwards.
//!
//! The procedure is pure over [`PrimingOps`], so every branch is tested
//! without a desktop. Nothing here marks the call as sent: focus records and
//! accessibility writes cannot type text, so a refusal stays a rerunnable
//! `BackgroundUnavailable` (`skylight::reporting_partial`). The records never
//! include a defocus record: posted to a background app on macOS 26 it wiped
//! the typed document (`focus::restore_key_focus`).
//!
//! Step 1, the key-belief cache, is not here: without an accessibility focus
//! observer to invalidate it, a cached belief could outlive a focus change
//! the user made, so every send reads focus again.

use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorReport};
use senpi_desktop_core::report::{Disposition, FocusRestoration};

/// How recent a user press in the frontmost target app must be to refuse
/// the keys (the session's step-0 threshold, `intervention::TAKEOVER_MS`).
pub(crate) const TAKEOVER: Duration = Duration::from_millis(1_500);
/// How long the short record form, the accessibility write and the
/// hand-back are given to show their window as key.
const CONFIRM: Duration = Duration::from_millis(40);
/// How often a confirmation re-reads focus.
const CONFIRM_POLL: Duration = Duration::from_millis(10);
/// The settle after each full record form, before its one re-read.
const FULL_SETTLE: Duration = Duration::from_millis(120);

/// One read of the target application's keyboard focus: its
/// `AXFocusedWindow` and the window of its `AXFocusedUIElement`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct FocusRead {
    pub(crate) focused_window: Option<u32>,
    pub(crate) element_window: Option<u32>,
}

impl FocusRead {
    /// Both reads name `target`: keys addressed to the process land there.
    fn proves(self, target: u32) -> bool {
        self.focused_window == Some(target) && self.element_window == Some(target)
    }
}

/// What a focus read found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Read {
    Focus(FocusRead),
    /// The application did not answer (accessibility error or timeout).
    Unreadable,
    /// The target window or its process no longer exists.
    Gone,
}

/// One attempt to make the target window key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Move {
    /// Focus plus make-key records to the target process, short pauses.
    Short,
    /// The same records with a settle between them.
    Full,
    /// The accessibility `AXFocusedWindow` write.
    AxWrite,
}

/// The order the moves are tried in: the full form runs at most twice.
const MOVES: [Move; 4] = [Move::Short, Move::Full, Move::Full, Move::AxWrite];

/// The live reads and posts priming and its hand-back use.
pub(crate) trait PrimingOps {
    /// Reads the target application's keyboard focus.
    fn read(&mut self) -> Read;
    /// Posts `step` for the target window; `false` when it could not go out.
    fn apply(&mut self, step: Move) -> bool;
    /// Waits `time`.
    fn wait(&mut self, time: Duration);
    /// The target application is frontmost and the user pressed a key or
    /// clicked in it within [`TAKEOVER`].
    fn user_active_in_target(&mut self) -> bool;
    /// Whether the target application is the user's frontmost app.
    fn target_app_front(&mut self) -> bool;
    /// The application's on-screen windows, front to back.
    fn window_order(&mut self) -> Vec<u32>;
    /// Makes `window` the application's key window through accessibility;
    /// `false` when the window is gone or the write was refused.
    fn make_key(&mut self, window: u32) -> bool;
}

/// What hand-back puts back inside the target application once keys moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HandBack {
    target: u32,
    /// The application's key window before priming, when it had one.
    previous_key: Option<u32>,
    /// The application's on-screen windows before priming, front to back.
    order: Vec<u32>,
    /// The application was frontmost when priming started.
    front_at_start: bool,
}

/// How the target window became key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Primed {
    AlreadyKey,
    Moved(Move),
}

/// The outcome of priming plus, once a move was posted, what hand-back
/// owes, whether or not the keys may go.
#[derive(Debug)]
pub(crate) struct Priming {
    pub(crate) outcome: CoreResult<Primed>,
    pub(crate) hand_back: Option<HandBack>,
}

/// Steps 2-6 for `target`. Step 2 reads focus: when both reads already name
/// the target the keys may go. Otherwise the application's key window is
/// recorded and the moves run in [`MOVES`] order, each followed by a re-read;
/// the first one the reads prove ends it. Before the keys go the step-0
/// takeover gate is checked again, since priming takes time. No proof is a
/// `key_route_unproven` refusal with nothing sent.
pub(crate) fn prime(target: u32, ops: &mut impl PrimingOps) -> Priming {
    let first = match ops.read() {
        Read::Gone => return Priming { outcome: Err(gone(target)), hand_back: None },
        Read::Unreadable => {
            return Priming { outcome: Err(unproven(target, None)), hand_back: None };
        }
        Read::Focus(read) if read.proves(target) => {
            return Priming { outcome: Ok(Primed::AlreadyKey), hand_back: None };
        }
        Read::Focus(read) => read,
    };
    let hand_back = HandBack {
        target,
        previous_key: first.focused_window.filter(|&window| window != target),
        order: ops.window_order(),
        front_at_start: ops.target_app_front(),
    };
    let mut last = Some(first);
    for step in MOVES {
        // A record the system refused may still have been delivered in
        // part, so the read decides in every case.
        ops.apply(step);
        match confirm(target, step, ops) {
            Confirm::Proven => {
                let outcome = if ops.user_active_in_target() {
                    Err(user_active())
                } else {
                    Ok(Primed::Moved(step))
                };
                return Priming { outcome, hand_back: Some(hand_back) };
            }
            Confirm::Gone => return Priming { outcome: Err(gone(target)), hand_back: Some(hand_back) },
            Confirm::Not(read) => last = read.or(last),
        }
    }
    Priming { outcome: Err(unproven(target, last)), hand_back: Some(hand_back) }
}

enum Confirm {
    Proven,
    Gone,
    /// Not proven; the last read that answered, if any.
    Not(Option<FocusRead>),
}

/// Re-reads focus after `step`: once after the full form's settle, else
/// every [`CONFIRM_POLL`] for up to [`CONFIRM`].
fn confirm(target: u32, step: Move, ops: &mut impl PrimingOps) -> Confirm {
    let (poll, budget) = match step {
        Move::Full => (FULL_SETTLE, FULL_SETTLE),
        Move::Short | Move::AxWrite => (CONFIRM_POLL, CONFIRM),
    };
    let mut waited = Duration::ZERO;
    let mut last = None;
    while waited < budget {
        ops.wait(poll);
        waited += poll;
        match ops.read() {
            Read::Focus(read) if read.proves(target) => return Confirm::Proven,
            Read::Focus(read) => last = Some(read),
            Read::Unreadable => {}
            Read::Gone => return Confirm::Gone,
        }
    }
    Confirm::Not(last)
}

/// Step 8, layer 1: puts the application's previous key window back, unless
/// the user made the application frontmost since priming started (their
/// choice of window wins). The previous key window is tried first, then the
/// application's other windows front to back, skipping any that are gone;
/// `NotNeeded` when there is no window to put back. Never raises.
pub(crate) fn hand_back(plan: &HandBack, ops: &mut impl PrimingOps) -> FocusRestoration {
    if !plan.front_at_start && ops.target_app_front() {
        return FocusRestoration::UserMovedOn;
    }
    let mut candidates = plan.previous_key.into_iter().chain(plan.order.iter().copied());
    let mut tried = false;
    let Some(window) = candidates.find(|&window| {
        if window == plan.target {
            return false;
        }
        tried = true;
        ops.make_key(window)
    }) else {
        return if tried { FocusRestoration::NotConfirmed } else { FocusRestoration::NotNeeded };
    };
    let mut waited = Duration::ZERO;
    while waited < CONFIRM {
        ops.wait(CONFIRM_POLL);
        waited += CONFIRM_POLL;
        if matches!(ops.read(), Read::Focus(read) if read.focused_window == Some(window)) {
            return FocusRestoration::Restored;
        }
    }
    FocusRestoration::NotConfirmed
}

/// Primes `target`, runs `send` only on proof, then hands key focus back
/// inside the application when priming moved it, whatever `send` returned.
/// The second value is that hand-back's outcome (`None` when key never
/// moved).
pub(crate) fn primed_delivery<O: PrimingOps, T>(
    target: u32,
    ops: &mut O,
    send: impl FnOnce(&mut O) -> CoreResult<T>,
) -> (CoreResult<T>, Option<FocusRestoration>) {
    let Priming { outcome, hand_back: plan } = prime(target, ops);
    let result = outcome.and_then(|_| send(ops));
    let restored = plan.map(|plan| hand_back(&plan, ops));
    (result, restored)
}

fn gone(target: u32) -> DesktopError {
    DesktopError::window_not_found(format!(
        "window {target} closed while it was being made its application's key window; nothing was sent"
    ))
}

fn unproven(target: u32, last: Option<FocusRead>) -> DesktopError {
    let name = |window: Option<u32>| window.map_or_else(|| "none".to_owned(), |window| window.to_string());
    let (focused, element) = match last {
        Some(read) => (name(read.focused_window), name(read.element_window)),
        None => ("unreadable".to_owned(), "unreadable".to_owned()),
    };
    DesktopError::background_unavailable(format!(
        "window {target} could not be confirmed as its application's key window (focusedWindow \
         {focused}, elementWindow {element}), so keys could reach another window of the same \
         application; nothing was sent; retry with delivery:\"foreground\" or use ax actions"
    ))
    .with_report(ErrorReport {
        reason: Some("key_route_unproven".to_owned()),
        disposition: Some(Disposition::NOT_DELIVERED_SAFE),
        ..ErrorReport::default()
    })
}

fn user_active() -> DesktopError {
    DesktopError::background_unavailable(
        "the user pressed a key or clicked in the target's application, which is frontmost, while \
         its window was being made key; nothing was sent; retry once they pause",
    )
    .with_report(ErrorReport {
        reason: Some("user_active_in_target".to_owned()),
        disposition: Some(Disposition::NOT_DELIVERED_AFTER_USER),
        ..ErrorReport::default()
    })
}

#[cfg(test)]
#[path = "priming_tests.rs"]
mod tests;
