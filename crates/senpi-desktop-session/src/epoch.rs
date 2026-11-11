//! The session's coordinate epoch (DESIGN 5, Epoch): a display
//! reconfiguration, a lock, a sleep or a Space switch moves it. In an
//! object-mode session a move supersedes every frame, expires every ref and
//! is announced as `epoch.changed`; a null-mode session watches nothing, so
//! its frames, refs and notifications stay as they were.

use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::ax::AxRegistry;
use senpi_desktop_core::backend::{EpochSource, ScreenProbe};
use senpi_desktop_core::error::{DesktopError, ErrorReport};
use senpi_desktop_core::protocol_results::{EpochChanged, EpochReason};
use senpi_desktop_core::report::Disposition;
use senpi_desktop_core::types::ScreenState;

use crate::worker::Worker;

/// What an armed (object-mode) session samples for moves.
struct Watched {
    source: Option<Arc<dyn EpochSource>>,
    source_seen: usize,
    screen: Option<Arc<dyn ScreenProbe>>,
    last_screen: Option<ScreenState>,
}

#[derive(Default)]
struct Log {
    /// `None` while the session is not in object mode.
    watched: Option<Watched>,
    moves: Vec<EpochReason>,
    announced: usize,
}

impl Log {
    /// Appends the moves the backend's source and the lock/sleep probe show
    /// since the last sample. A lock or a sleep moves the epoch when it
    /// begins; the unlock or wake after it finds the frames already gone.
    fn sample(&mut self) {
        let Some(watched) = self.watched.as_mut() else { return };
        if let Some(source) = &watched.source {
            let moves = source.moves_since(watched.source_seen);
            watched.source_seen = watched.source_seen.saturating_add(moves.len());
            self.moves.extend(moves);
        }
        if let Some(screen) = &watched.screen {
            let now = screen.screen_state(None);
            if let Some(before) = watched.last_screen {
                if now.locked && !before.locked {
                    self.moves.push(EpochReason::Lock);
                }
                if now.display_asleep && !before.display_asleep {
                    self.moves.push(EpochReason::Sleep);
                }
            }
            watched.last_screen = Some(now);
        }
    }
}

/// The moves of one session, shared by its thread and its handle.
#[derive(Clone, Default)]
pub(crate) struct EpochLog(Arc<Mutex<Log>>);

impl EpochLog {
    /// The `epoch.changed` notifications not announced yet, oldest first.
    pub(crate) fn take_announcements(&self) -> Vec<EpochChanged> {
        let mut log = self.0.lock();
        let fresh = log.moves[log.announced..]
            .iter()
            .map(|&reason| EpochChanged { reason })
            .collect();
        log.announced = log.moves.len();
        fresh
    }
}

/// The session thread's side: the shared log, and how many of its moves the
/// frame cache and the ref registry already reflect.
#[derive(Default)]
pub(crate) struct Epochs {
    log: EpochLog,
    applied: usize,
}

impl Epochs {
    pub(crate) fn new(log: EpochLog) -> Self {
        Self { log, applied: 0 }
    }

    /// At every backend change: an object-mode session watches the new
    /// backend from its current state on; any other session watches nothing.
    pub(crate) fn arm(
        &mut self,
        object: bool,
        source: Option<Arc<dyn EpochSource>>,
        screen: Option<Arc<dyn ScreenProbe>>,
    ) {
        let mut log = self.log.0.lock();
        log.watched = object.then(|| Watched {
            source_seen: source.as_ref().map_or(0, |source| source.moves_since(0).len()),
            source,
            last_screen: screen.as_ref().map(|screen| screen.screen_state(None)),
            screen,
        });
        self.applied = log.moves.len();
    }

    /// A move the session itself observed (a Space switch the backend
    /// refused input over); ignored outside object mode.
    pub(crate) fn record(&self, reason: EpochReason) {
        let mut log = self.log.0.lock();
        if log.watched.is_some() {
            log.moves.push(reason);
        }
    }

    /// Samples the sources; whether the epoch moved since the last call.
    fn take_moved(&mut self) -> bool {
        let mut log = self.log.0.lock();
        log.sample();
        let moved = log.moves.len() > self.applied;
        self.applied = log.moves.len();
        moved
    }

    /// A check an input call runs between its events, without the worker:
    /// whether the epoch moved since the request began.
    pub(crate) fn probe(&self) -> EpochProbe {
        EpochProbe {
            log: self.log.clone(),
            baseline: self.applied,
        }
    }
}

pub(crate) struct EpochProbe {
    log: EpochLog,
    baseline: usize,
}

impl EpochProbe {
    pub(crate) fn moved(&self) -> bool {
        let mut log = self.log.0.lock();
        log.sample();
        log.moves.len() > self.baseline
    }
}

/// The epoch moved before the request's first input event: nothing was sent.
pub(crate) fn superseded_before_input() -> DesktopError {
    superseded(
        "the desktop changed (display, lock, sleep or Space) before any input was sent; capture the target \
         again",
        Disposition::NOT_DELIVERED_SAFE,
    )
}

/// The epoch moved after some of the request's input went out: where the
/// rest would have landed, and whether what was sent landed where meant, is
/// unknown.
pub(crate) fn superseded_mid_input() -> DesktopError {
    superseded(
        "the desktop changed (display, lock, sleep or Space) while input was being sent; capture the target \
         again and check what arrived before sending more",
        Disposition::UNKNOWN,
    )
}

fn superseded(message: &str, disposition: Disposition) -> DesktopError {
    DesktopError::invalid_coordinate_frame(message).with_report(ErrorReport {
        reason: Some("superseded".to_owned()),
        disposition: Some(disposition),
        ..ErrorReport::default()
    })
}

impl Worker {
    /// Brings the frames and refs up to the current epoch: after a move every
    /// frame is superseded and every ref expired.
    pub(crate) fn apply_epoch(&mut self) {
        if !self.epochs.take_moved() {
            return;
        }
        self.frames.supersede_all();
        self.registry
            .restore(AxRegistry::with_report_mode(self.registry.report_mode()));
    }
}

#[cfg(test)]
#[path = "epoch/tests.rs"]
mod tests;
