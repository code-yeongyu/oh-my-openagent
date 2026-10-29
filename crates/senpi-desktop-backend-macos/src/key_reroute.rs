//! Physical-key repair during a guarded background action.
//! Ported from oh-my-pi 0838d2ab44 (MIT, desktop/macos/key_reroute.rs).
//! Each backend owns its tap threads, including the bounded post-action
//! linger. Dropping the backend stops and joins all of its remaining taps.

mod ffi;
mod tap;
#[cfg(test)]
mod teardown_tests;
mod worker;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use parking_lot::Mutex;
use senpi_desktop_core::key_reroute::audit::AuditSink;
use senpi_desktop_core::key_reroute::Registry;

static REGISTRY: Mutex<Registry> = Mutex::new(Registry::new());
static GENERATION: AtomicU64 = AtomicU64::new(0);
const START_TIMEOUT: Duration = Duration::from_secs(1);

struct Running {
    halt: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

pub(crate) struct RerouteOwner {
    threads: Arc<Mutex<Vec<Running>>>,
    _exit: crate::exit_safety::Registration,
}

impl Default for RerouteOwner {
    fn default() -> Self {
        let threads = Arc::new(Mutex::new(Vec::new()));
        let owned = Arc::clone(&threads);
        Self {
            threads,
            _exit: crate::exit_safety::register_owner(move || stop_threads(&owned)),
        }
    }
}

impl RerouteOwner {
    fn register(&self, running: Running) {
        let mut threads = self.threads.lock();
        let mut index = 0;
        while index < threads.len() {
            if threads[index].thread.is_finished() {
                if threads.swap_remove(index).thread.join().is_err() {
                    eprintln!("computer use keyboard reroute: observer panicked");
                }
            } else {
                index += 1;
            }
        }
        threads.push(running);
    }
}

impl Drop for RerouteOwner {
    fn drop(&mut self) {
        stop_threads(&self.threads);
    }
}

fn stop_threads(owned: &Mutex<Vec<Running>>) {
    let threads = std::mem::take(&mut *owned.lock());
    for running in &threads {
        running.halt.store(true, Ordering::Release);
        running.thread.thread().unpark();
    }
    for running in threads {
        if running.thread.thread().id() != thread::current().id() && running.thread.join().is_err() {
            eprintln!("computer use keyboard reroute: observer panicked during teardown");
        }
    }
}

pub(crate) struct KeyReroute {
    ended: Arc<AtomicBool>,
}

impl KeyReroute {
    pub(crate) fn start(
        owner: &RerouteOwner,
        user: i32,
        target: i32,
        audit: AuditSink,
    ) -> Option<Self> {
        if user <= 0 || target <= 0 || user == target || tap::secure_entry() {
            return None;
        }
        let ended = Arc::new(AtomicBool::new(false));
        let halt = Arc::new(AtomicBool::new(false));
        let action_ended = Arc::clone(&ended);
        let stop = Arc::clone(&halt);
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
        let (ready, receive) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("desktop-key-reroute".into())
            .spawn(move || worker::run(user, target, generation, action_ended, stop, ready, audit))
            .ok()?;
        owner.register(Running {
            halt: Arc::clone(&halt),
            thread,
        });
        ready_within(&receive, &halt, START_TIMEOUT).then_some(Self { ended })
    }
}

fn ready_within(receive: &mpsc::Receiver<bool>, halt: &AtomicBool, budget: Duration) -> bool {
    if matches!(receive.recv_timeout(budget), Ok(true)) {
        true
    } else {
        halt.store(true, Ordering::Release);
        false
    }
}

impl Drop for KeyReroute {
    fn drop(&mut self) {
        self.ended.store(true, Ordering::Release);
    }
}

fn keyboard_holders() -> Option<(i32, Option<i32>)> {
    crate::skylight::keyboard_holders()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use senpi_desktop_core::key_reroute::audit::{AuditEvent, AuditLease};

    #[test]
    fn startup_requires_ready_and_stops_failed_disconnected_or_late_workers() {
        for (message, disconnected, expected) in [
            (Some(true), false, true),
            (Some(false), false, false),
            (None, true, false),
            (None, false, false),
        ] {
            let (send, receive) = mpsc::sync_channel(1);
            if let Some(message) = message {
                send.send(message).unwrap();
            }
            let sender = if disconnected {
                drop(send);
                None
            } else {
                Some(send)
            };
            let halt = AtomicBool::new(false);
            assert_eq!(ready_within(&receive, &halt, Duration::ZERO), expected);
            assert_eq!(halt.load(Ordering::Acquire), !expected);
            drop(sender);
        }
    }

    #[test]
    fn signal_cleanup_joins_the_owner_and_flushes_its_disarm_count() {
        let owner = RerouteOwner::default();
        let (events, received) = mpsc::channel();
        let (ready, started) = mpsc::sync_channel(1);
        let halt = Arc::new(AtomicBool::new(false));
        let stop = Arc::clone(&halt);
        let thread = thread::spawn(move || {
            let mut audit = AuditLease::arm(77, Arc::new(move |event| events.send(event).unwrap()));
            audit.moved_key();
            ready.send(()).unwrap();
            while !stop.load(Ordering::Acquire) {
                thread::park();
            }
            drop(audit);
        });
        owner.register(Running { halt, thread });
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), AuditEvent::Arm { arm_id: 77 });
        // The normal/signal exit dispatcher invokes this registered owner.
        (owner._exit)();
        assert!(matches!(received.recv_timeout(Duration::from_secs(5)).unwrap(),
            AuditEvent::Disarm { arm_id: 77, moved_key_count: 1, .. }));
        assert!(owner.threads.lock().is_empty());
        drop(owner);
        assert!(received.try_recv().is_err(), "no second disarm on backend drop");
    }

    #[test]
    fn backend_teardown_stops_and_joins_every_owned_tap_thread() {
        let owner = RerouteOwner::default();
        let (subscribed, subscribed_rx) = mpsc::sync_channel(2);
        let (exited, exited_rx) = mpsc::sync_channel(2);
        for _ in 0..2 {
            let halt = Arc::new(AtomicBool::new(false));
            let stop = Arc::clone(&halt);
            let ready = subscribed.clone();
            let done = exited.clone();
            let thread = thread::spawn(move || {
                ready.send(()).unwrap();
                while !stop.load(Ordering::Acquire) {
                    thread::park();
                }
                done.send(()).unwrap();
            });
            owner.register(Running { halt, thread });
        }
        for _ in 0..2 {
            subscribed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        let (dropped, dropped_rx) = mpsc::sync_channel(1);
        let dropper = thread::spawn(move || {
            drop(owner);
            dropped.send(()).unwrap();
        });
        dropped_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        for _ in 0..2 {
            exited_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        dropper.join().unwrap();
    }
}
