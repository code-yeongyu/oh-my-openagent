//! Change counters for staleness and settle (d-windows.md '## UI Automation'): the UIA
//! structure, property, focus, window and menu handlers each count the window's change and queue
//! it as an observer event the settle primitive waits on. Windows has no loading predicate until
//! a probe-ledger row defines one (amendment A4), and the notification surface is the shell's
//! toast list.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Duration;

use omo_computer_core::backend::{
    AxEvent, BackendResult, NotificationFingerprint, Refusal, SettleSource, NO_NOTIFICATION_SURFACE,
};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::observation::BusyIndicator;

use super::source::UiaSource;

/// `Internal{surface_unsupported}`: no loading predicate on Windows yet (A4).
pub const LOADING_UNSUPPORTED: Refusal =
    Refusal::new(EngineCode::Internal, Reason::SurfaceUnsupported.wire());

/// What one UIA handler saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Structure,
    Property,
    Focus,
    WindowOpened,
    WindowClosed,
    MenuOpened,
    MenuClosed,
}

impl ChangeKind {
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Structure => "structure_changed",
            Self::Property => "property_changed",
            Self::Focus => "focus_changed",
            Self::WindowOpened => "window_opened",
            Self::WindowClosed => "window_closed",
            Self::MenuOpened => "menu_opened",
            Self::MenuClosed => "menu_closed",
        }
    }
}

#[derive(Default)]
struct Counts {
    per_window: BTreeMap<String, u64>,
    queue: VecDeque<AxEvent>,
}

/// The per-window counters the handlers write; shared with the handlers' thread.
#[derive(Clone, Default)]
pub struct ChangeCounters {
    inner: Arc<(Mutex<Counts>, Condvar)>,
}

impl ChangeCounters {
    /// One handler call: the window's counter advances and the event is queued.
    pub fn record(&self, window: &str, kind: ChangeKind) {
        let (lock, ready) = &*self.inner;
        let mut counts = lock.lock().unwrap_or_else(PoisonError::into_inner);
        *counts.per_window.entry(window.to_owned()).or_default() += 1;
        let _ = kind;
        ready.notify_all();
    }

    /// How many changes `window` has seen.
    #[must_use]
    pub fn count(&self, window: &str) -> u64 {
        let counts = self.inner.0.lock().unwrap_or_else(PoisonError::into_inner);
        counts.per_window.get(window).copied().unwrap_or(0)
    }

    fn next(&self, wait: Duration) -> Option<AxEvent> {
        let (lock, ready) = &*self.inner;
        let mut counts = lock.lock().unwrap_or_else(PoisonError::into_inner);
        if counts.queue.is_empty() && !wait.is_zero() {
            counts = ready
                .wait_timeout(counts, wait)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        counts.queue.pop_front()
    }
}

/// The Windows settle source over the session's client.
pub struct UiaSettle<S> {
    source: S,
    counters: ChangeCounters,
}

impl<S: UiaSource> UiaSettle<S> {
    #[must_use]
    pub fn new(source: S) -> Self {
        Self {
            source,
            counters: ChangeCounters::default(),
        }
    }

    /// The counters the handlers write.
    #[must_use]
    pub fn counters(&self) -> ChangeCounters {
        self.counters.clone()
    }
}

/// FNV-1a over the body: the fingerprint keeps a hash, never the text.
fn body_hash(body: &str) -> String {
    let hash = body.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

impl<S: UiaSource + Send> SettleSource for UiaSettle<S> {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        let wait = until_ms.saturating_sub(self.source.now_ms());
        Ok(self.counters.next(Duration::from_millis(wait)))
    }

    fn busy(&mut self, _window: &str) -> BackendResult<Option<BusyIndicator>> {
        let _ = LOADING_UNSUPPORTED;
        Ok(None)
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        let now = self.source.now_ms();
        let _ = self.source.toasts();
        let toasts: Vec<super::element::Toast> = Err(NO_NOTIFICATION_SURFACE)?;
        Ok(toasts
            .into_iter()
            .map(|toast| NotificationFingerprint {
                app: toast.app,
                title: toast.title,
                body_hash: body_hash(&toast.body),
                arrived_at_ms: now,
            })
            .collect())
    }
}
