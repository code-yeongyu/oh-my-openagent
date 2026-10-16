//! Immediate refusal is separate from release, durable commit and publication.
use super::{Ordering, StopSource, Supervisor, SupervisorStatus, Weak};
use std::time::{Duration, Instant};

const RELEASE_BUDGET: Duration = Duration::from_secs(1);
/// The emergency release's own work, clocked by its worker from the moment it
/// starts: scheduling latency before the worker runs does not consume it.
pub(super) const EMERGENCY_BUDGET: Duration = Duration::from_millis(5);
/// Hard cap on how long the exiting thread waits for the emergency worker to
/// be scheduled and finish a release it started inside its budget.
const EMERGENCY_WAIT: Duration = Duration::from_millis(100);

pub(super) struct StopLimits {
    pub(super) release: Option<Duration>,
    pub(super) emergency: Duration,
    pub(super) emergency_wait: Duration,
}

impl StopLimits {
    /// The limits every real stop uses; tests reuse them to exercise production values.
    pub(super) const fn production(bounded_release: bool) -> Self {
        Self {
            release: if bounded_release {
                Some(RELEASE_BUDGET)
            } else {
                None
            },
            emergency: EMERGENCY_BUDGET,
            emergency_wait: EMERGENCY_WAIT,
        }
    }
}

impl Supervisor {
    /// Callback-safe refusal: no lock, allocation, persistence or notification.
    /// The owner must schedule `trigger_stop` outside its event callback.
    pub fn suspend_input(&self) {
        self.suspended.store(true, Ordering::SeqCst);
    }

    /// A new stop has refused input but cannot yet be reported as committed.
    #[must_use]
    pub fn stop_pending(&self) -> bool {
        self.is_suspended() && !self.published.load(Ordering::SeqCst)
    }

    /// Wire-facing state. Input gates must use `status` or `is_suspended`.
    #[must_use]
    pub fn published_status(&self) -> SupervisorStatus {
        let mut status = self.status();
        status.suspended = self.published.load(Ordering::SeqCst);
        status
    }

    /// Register before input starts; the session retains the strong handle.
    /// Backends without independent release retain their existing unbounded
    /// cleanup contract instead of gaining an unsafe new fatal deadline.
    pub fn register_emergency_release(
        &self,
        release: &std::sync::Arc<dyn senpi_desktop_core::backend::EmergencyRelease>,
    ) -> senpi_desktop_core::error::CoreResult<()> {
        let mut worker = self.emergency.lock();
        if worker.is_none() {
            *worker = Some(super::emergency::EmergencyWorker::start().map_err(|error| {
                senpi_desktop_core::error::DesktopError::internal(format!(
                    "cannot start emergency release worker: {error}"
                ))
            })?);
        }
        if let Some(worker) = worker.as_ref() {
            worker.register(release);
        }
        self.bounded_release.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Complete a stop off the event callback. Never acknowledge an uncommitted
    /// stop. A stuck input scope cannot prevent saving the latch before exit.
    pub fn trigger_stop(&self, source: StopSource) {
        self.finish_stop(
            source,
            StopLimits::production(self.bounded_release.load(Ordering::SeqCst)),
        );
    }

    pub(super) fn finish_stop(&self, source: StopSource, limits: StopLimits) {
        self.suspend_input();
        let _commit = self.stop_commit_lock.lock();
        let signals: Vec<_> = {
            let mut registered = self.hold_signals.lock();
            registered.retain(|signal| signal.strong_count() > 0);
            registered.iter().filter_map(Weak::upgrade).collect()
        };
        for signal in &signals {
            signal.request_release();
        }
        let deadline = limits.release.map(|budget| Instant::now() + budget);
        let released = signals
            .iter()
            .all(|signal| signal.await_release_until(deadline));
        if !released {
            if let Some(worker) = self.emergency.lock().as_ref() {
                worker.attempt(limits.emergency, limits.emergency_wait);
            }
        }
        if let Some(commit) = &self.stop_commit {
            commit();
        }
        if !released {
            eprintln!(
                "senpi-desktop: input release deadline exceeded; stop committed, exiting without acknowledgement"
            );
            (self.fatal_exit)(1);
            return;
        }
        let mut stopped_by = self.stopped_by.lock();
        self.stop_epoch.fetch_add(1, Ordering::SeqCst);
        stopped_by.get_or_insert(source);
        self.suspended.store(true, Ordering::SeqCst);
        self.published.store(true, Ordering::SeqCst);
        drop(stopped_by);
        for signal in signals {
            signal.stopped();
        }
    }
}
