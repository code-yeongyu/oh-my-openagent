//! The helper's own hard cap (design 6.2). The owner also kills the helper at its deadline; this watchdog
//! bounds the helper even when the owner is gone.

use std::thread;
use std::time::Duration;

pub const HARD_CAP: Duration = Duration::from_secs(20);

/// Runs `expire` on a separate thread once `wait` returns. The calling thread's work is never awaited,
/// so an OS call that never returns cannot hold the process past the cap.
pub fn arm(wait: impl FnOnce() + Send + 'static, expire: impl FnOnce() + Send + 'static) {
    thread::spawn(move || {
        wait();
        expire();
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn expires_when_its_clock_fires_and_not_before() {
        let (tick, clock) = mpsc::channel::<()>();
        let (expired, expiry) = mpsc::channel::<()>();
        arm(
            move || {
                let _ = clock.recv();
            },
            move || {
                let _ = expired.send(());
            },
        );
        assert_eq!(expiry.try_recv(), Err(mpsc::TryRecvError::Empty));
        tick.send(()).expect("the watchdog thread holds the clock");
        expiry
            .recv_timeout(Duration::from_secs(10))
            .expect("waited 10s for the watchdog to expire after its clock fired");
    }
}
