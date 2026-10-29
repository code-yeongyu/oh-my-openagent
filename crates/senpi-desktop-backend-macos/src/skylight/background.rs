//! Concurrent focus containment, ported from oh-my-pi 0838d2ab44 (MIT,
//! desktop/macos/skylight.rs). No AppKit activation is used by this watcher.

mod restore;
mod signals;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use senpi_desktop_core::background_action::{BackgroundActionState, BackgroundActionWatch};
use senpi_desktop_core::background_focus::{
    BackgroundFocusLease, FocusDecision, ACTION_REFLEX, SWITCH_SAMPLE,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::psn::{post_focus_record, FocusMarker, ProcessSerialNumber};
use signals::ClickPlacer;

struct Shared {
    state: Arc<BackgroundActionState>,
    user: u32,
    psn: ProcessSerialNumber,
    placer: ClickPlacer,
    stopped: AtomicBool,
}

struct Watch {
    reroute: Option<crate::key_reroute::KeyReroute>,
    shared: Arc<Shared>,
    observer: Option<JoinHandle<CoreResult<()>>>,
    samplers: Vec<JoinHandle<()>>,
}

/// Reusable entry for a background action on `pid`, including Spaces once
/// its branch is folded. Missing SPI preserves the previous no-watcher path.
pub(crate) fn begin(
    pid: u32,
    owner: &crate::key_reroute::RerouteOwner,
    audit: senpi_desktop_core::key_reroute::audit::AuditSink,
) -> CoreResult<Option<Box<dyn BackgroundActionWatch>>> {
    if super::spi::foreground().is_none() || super::spi::required().is_err() {
        return Ok(None);
    }
    let Some(user) = super::front_pid().and_then(|pid| u32::try_from(pid).ok()) else {
        return Err(DesktopError::background_unavailable(
            "cannot establish the front process; nothing was sent",
        ));
    };
    if user == pid {
        return Ok(None);
    }
    let user_pid = i32::try_from(user)
        .map_err(|_| DesktopError::background_unavailable("invalid front process"))?;
    let Some(psn) = super::psn_for_process(user_pid, 0) else {
        return Err(DesktopError::background_unavailable(
            "cannot resolve the front process; nothing was sent",
        ));
    };
    let key = crate::ax::focused_window_id(user_pid);
    // The AX read can block. Never create a claim over a newer user selection.
    if super::front_pid() != Some(user_pid) {
        return Err(DesktopError::background_unavailable(
            "the front process changed while preparing input; nothing was sent",
        ));
    }
    let placer = ClickPlacer::new(user_pid);
    placer.place();
    let now = Instant::now();
    let lease = BackgroundFocusLease::new(user, pid, key, signals::read(now, &placer, None), now);
    let shared = Arc::new(Shared {
        state: Arc::new(BackgroundActionState::new(lease)),
        user,
        psn,
        placer,
        stopped: AtomicBool::new(false),
    });
    let mut watch = Watch {
        reroute: crate::key_reroute::KeyReroute::start(
            owner, user_pid,
            i32::try_from(pid).map_err(|_| DesktopError::background_unavailable("invalid target process"))?,
            audit,
        ),
        shared: Arc::clone(&shared),
        observer: None,
        samplers: Vec::new(),
    };
    let failed = |error| {
        DesktopError::background_unavailable(format!(
            "could not start the background focus guard: {error}; nothing was sent"
        ))
    };
    let worker = Arc::clone(&shared);
    watch.observer = Some(
        thread::Builder::new()
            .name("desktop-focus-lease".into())
            .spawn(move || observe(&worker))
            .map_err(failed)?,
    );
    let worker = Arc::clone(&shared);
    watch.samplers.push(
        thread::Builder::new()
            .name("desktop-switch-sampler".into())
            .spawn(move || {
                while !worker.stopped.load(Ordering::Acquire) {
                    if let Some(front) = front_pid() {
                        let now = Instant::now();
                        let signals = worker.signals(now);
                        worker.state.lease.lock().observe(front, None, signals, now);
                    }
                    thread::park_timeout(SWITCH_SAMPLE);
                }
            })
            .map_err(failed)?,
    );
    watch.samplers.push(
        thread::Builder::new()
            .name("desktop-click-placer".into())
            .spawn(move || {
                while !shared.stopped.load(Ordering::Acquire) {
                    shared.placer.place();
                    thread::park_timeout(SWITCH_SAMPLE);
                }
            })
            .map_err(failed)?,
    );
    Ok(Some(Box::new(watch)))
}

impl Shared {
    fn signals(&self, now: Instant) -> senpi_desktop_core::background_focus::SwitchSignals {
        signals::read(now, &self.placer, *self.state.last_send.lock())
    }
}

impl Watch {
    fn join(&mut self) -> CoreResult<()> {
        self.shared.stopped.store(true, Ordering::Release);
        if let Some(observer) = &self.observer {
            observer.thread().unpark();
        }
        for sampler in &self.samplers {
            sampler.thread().unpark();
        }
        let mut result = self.observer.take().map_or(Ok(()), |observer| {
            observer.join().unwrap_or_else(|_| {
                Err(DesktopError::input_failed(
                    "background focus observer panicked",
                ))
            })
        });
        for sampler in self.samplers.drain(..) {
            if sampler.join().is_err() && result.is_ok() {
                result = Err(DesktopError::input_failed(
                    "background focus sampler panicked",
                ));
            }
        }
        self.reroute.take();
        result
    }
}

impl BackgroundActionWatch for Watch {
    fn state(&self) -> Arc<BackgroundActionState> {
        Arc::clone(&self.shared.state)
    }

    fn finish(&mut self) -> CoreResult<()> {
        *self.shared.state.last_send.lock() = Some(Instant::now());
        // AX actions may fail synchronously and activate their app afterwards.
        thread::sleep(ACTION_REFLEX);
        self.join()
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        let _ = self.join();
    }
}

fn front_pid() -> Option<u32> {
    super::front_pid().and_then(|pid| u32::try_from(pid).ok())
}

fn observe(shared: &Shared) -> CoreResult<()> {
    loop {
        match front_pid() {
            None if shared.state.lease.lock().disarmed => {}
            None => {
                return Err(DesktopError::input_failed(
                    "lost the front process during background input",
                ))
            }
            Some(front) => {
                let asked = Instant::now();
                let key = if front == shared.user && !shared.state.lease.lock().disarmed {
                    crate::ax::focused_window_id(shared.user as i32)
                } else {
                    None
                };
                let now = Instant::now();
                let signals = shared.signals(now);
                let decision = shared
                    .state
                    .lease
                    .lock()
                    .observe_read(front, key, asked, signals, now);
                if decision == FocusDecision::Restore {
                    // Timestamp BEFORE the last recheck: input between the
                    // recheck and the native request can still veto it.
                    let since = restore::event_clock();
                    let now = Instant::now();
                    let signals = shared.signals(now);
                    let still_ours = front_pid() == Some(front)
                        && shared.state.lease.lock().observe(front, None, signals, now)
                            == FocusDecision::Restore;
                    let kept = shared.state.lease.lock().key;
                    if still_ours && restore::hand_back(&shared.psn, kept.unwrap_or(0), since)? {
                        let own_click = shared.state.lease.lock().own_click_since(Instant::now());
                        let fresh_asked = Instant::now();
                        let fresh = own_click
                            .then(|| crate::ax::focused_window_id(shared.user as i32))
                            .flatten();
                        let now = Instant::now();
                        let signals = shared.signals(now);
                        // Revalidate after the blocking AX probe, including new
                        // switch signals, before posting a key-window record.
                        let current = front_pid() == Some(shared.user)
                            && shared.state.lease.lock().observe_read(
                                shared.user,
                                fresh,
                                fresh_asked,
                                signals,
                                now,
                            ) != FocusDecision::Disarm;
                        if current {
                            if let Some(key) = fresh.or(kept) {
                                if !post_focus_record(&shared.psn, key, FocusMarker::Focus) {
                                    return Err(DesktopError::input_failed(
                                        "background key-window restoration was rejected",
                                    ));
                                }
                                shared.state.lease.lock().keep_key(key, own_click);
                            }
                        }
                    }
                }
            }
        }
        if shared.stopped.load(Ordering::Acquire) {
            let now = Instant::now();
            let signals = shared.signals(now);
            if front_pid()
                .is_some_and(|front| shared.state.lease.lock().left_in_front(front, signals, now))
            {
                return Err(DesktopError::input_failed(
                    "an application came forward during the background action and is still in front; input may already have landed; inspect the desktop before sending more",
                ));
            }
            return Ok(());
        }
        thread::park_timeout(Duration::from_millis(10));
    }
}
