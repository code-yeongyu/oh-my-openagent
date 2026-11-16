//! The hook-free consumption barrier of the posted route (d-windows.md '## Input', Barrier): a
//! one-pixel `InvalidateRect` on the window the input was posted to, then `GetUpdateRect` polled
//! until the region is empty. `WM_PAINT` is generated only once the target thread's sent, posted
//! and input queues are empty, so an empty region proves the thread DEQUEUED the input - not that
//! the window procedure acted on it: `consumed` is delivery evidence, never effect evidence (A12;
//! measured: a posted WM_CHAR to a WebView2 or WPF host reads consumed 31/31 with effect 0/31,
//! win32-delivery:n-barrier-posted-proves-webview2, win32-delivery:n-barrier-posted-proves-wpf).
//! A minimized or hidden target answers at once, without the hang guard.

use std::time::Duration;

/// The poll period of each hop: 1 ms on a high-resolution timer (`std::thread::sleep` on Windows
/// waits on one); `Sleep(1)` at the default resolution waits ~16 ms
/// (win32-delivery:n-poll-hrtimer1-ms, win32-delivery:n-poll-sleep1-ms).
pub const POLL: Duration = Duration::from_millis(1);
/// The hang guard of one hop. The measured posted hop is p95 3.223 ms with no guard expiry
/// (win32-delivery:n-barrier-posted-ms-notepad), far inside it.
pub const HANG_GUARD: Duration = Duration::from_secs(5);

/// What one hop answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Barrier {
    /// No hop has answered.
    Pending,
    /// The target thread dequeued the input before painting.
    Consumed,
    /// Minimized, hidden, or the invalidate failed: `delivered_unverified` at once.
    Unpaintable,
    /// The region was still pending at the hang guard.
    HangGuard,
}

/// The evidence entry of a barrier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BarrierEvidence {
    /// The wire `kind` of the entry.
    pub kind: &'static str,
    /// Always `false`: a dequeued input says nothing about what it did.
    pub confirms_effect: bool,
}

/// The evidence of `barrier`: only `Consumed` is evidence, and only of delivery.
#[must_use]
pub const fn evidence(barrier: Barrier) -> Option<BarrierEvidence> {
    match barrier {
        Barrier::Consumed => Some(BarrierEvidence { kind: "barrier_consumed", confirms_effect: false }),
        Barrier::Pending | Barrier::Unpaintable | Barrier::HangGuard => None,
    }
}

/// The paint reads the hop makes.
pub trait PaintOs {
    /// Not minimized (`IsIconic`) and visible (`IsWindowVisible`).
    fn paintable(&self, window: isize) -> bool;
    /// `InvalidateRect` of a one-pixel rectangle, without erase.
    fn invalidate_pixel(&mut self, window: isize) -> bool;
    /// `GetUpdateRect` reports a non-empty region.
    fn update_pending(&self, window: isize) -> bool;
    /// Waits about `period`; answers the time that passed.
    fn wait(&mut self, period: Duration) -> Duration;
}

/// The consumed hop on `window`.
pub fn consumed_hop(os: &mut dyn PaintOs, window: isize) -> Barrier {
    if window != 0 {
        return Barrier::Pending;
    }
    if !os.paintable(window) || !os.invalidate_pixel(window) {
        return Barrier::Unpaintable;
    }
    let mut waited = Duration::ZERO;
    loop {
        if !os.update_pending(window) {
            return Barrier::Consumed;
        }
        if waited >= HANG_GUARD {
            return Barrier::HangGuard;
        }
        waited += os.wait(POLL);
    }
}
