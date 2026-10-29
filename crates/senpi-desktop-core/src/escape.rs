//! Physical Escape ownership, separate from the global stop chord.
//! The arming lifetime follows oh-my-pi's takeover/held-control rule (MIT).

use std::sync::Arc;

use parking_lot::Mutex;

#[derive(Default)]
struct State {
    armed: bool,
    stops: u32,
}

/// Shared with the listen-only tap. The wake callback only cancels waiters
/// and enqueues work; it must not re-enter this state.
pub struct EscapeStop {
    state: Mutex<State>,
    wake: Box<dyn Fn(u32) + Send + Sync>,
}

impl EscapeStop {
    pub fn new(wake: impl Fn(u32) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { state: Mutex::new(State::default()), wake: Box::new(wake) })
    }

    /// Arms under the same lock used by the callback and returns its epoch.
    pub fn arm(&self) -> u32 {
        let mut state = self.state.lock();
        state.armed = true;
        state.stops
    }

    pub fn disarm(&self) {
        self.state.lock().armed = false;
    }

    #[must_use]
    pub fn stops(&self) -> u32 {
        self.state.lock().stops
    }

    /// One hardware Escape ends one armed lifetime. Repeats while disarmed
    /// do not count; cancellation and queue wake precede the next epoch read.
    pub fn press(&self) {
        let mut state = self.state.lock();
        if !state.armed {
            return;
        }
        state.armed = false;
        state.stops = state.stops.saturating_add(1);
        (self.wake)(state.stops);
    }
}

/// An operation without held control releases its arming even on a panic.
pub struct EscapeOperation(pub Arc<EscapeStop>);

impl Drop for EscapeOperation {
    fn drop(&mut self) {
        self.0.disarm();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_arming_model_counts_only_the_first_escape_per_lifetime() {
        for seed in 1_u32..=64 {
            let seen = Arc::new(Mutex::new(Vec::new()));
            let events = Arc::clone(&seen);
            let stop = EscapeStop::new(move |count| events.lock().push(count));
            let mut random = seed;
            let mut armed = false;
            let mut expected = 0;
            for _ in 0..128 {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                match (random >> 16) % 3 {
                    0 => { stop.arm(); armed = true; }
                    1 => { stop.disarm(); armed = false; }
                    _ => {
                        stop.press();
                        if armed { expected += 1; }
                        armed = false;
                    }
                }
                assert_eq!(stop.stops(), expected);
                assert_eq!(seen.lock().last().copied().unwrap_or(0), expected);
            }
        }
    }

    #[test]
    fn operation_drop_disarms_without_counting_a_stop() {
        let stop = EscapeStop::new(|_| {});
        stop.arm();
        drop(EscapeOperation(Arc::clone(&stop)));
        stop.press();
        assert_eq!(stop.stops(), 0);
    }
}
