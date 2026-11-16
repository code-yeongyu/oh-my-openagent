//! The hook-to-worker handoff, independent of Win32 registration.
use std::sync::atomic::{AtomicBool, Ordering};

use senpi_desktop_safety::{StopSource, Supervisor};

#[derive(Default)]
pub(super) struct PendingStop(AtomicBool);

impl PendingStop {
    pub(super) fn request(&self, supervisor: &Supervisor) {
        supervisor.suspend_input();
        self.0.store(true, Ordering::SeqCst);
    }

    pub(super) fn complete(&self, supervisor: &Supervisor) -> bool {
        if !self.0.swap(false, Ordering::SeqCst) {
            return false;
        }
        supervisor.complete_stop(StopSource::Hotkey);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::PendingStop;
    use crate::stop_path::{
        chord::{Hotkey, DEFAULT_STOP_CHORD},
        physical::{KeyEvent, Outcome, PhysicalChord},
    };
    use senpi_desktop_safety::{Chord, MonotonicClock, Supervisor};
    use std::sync::{Arc, Mutex};

    #[test]
    fn one_physical_hook_chord_commits_exactly_one_stop_generation() {
        // Given: the real hook's chord decoder and callback/worker handoff.
        let generations = Arc::new(Mutex::new(Vec::new()));
        let committed = Arc::clone(&generations);
        let supervisor =
            Supervisor::with_stop_authority(Arc::new(MonotonicClock::new()), move |generation| {
                committed.lock().unwrap().push(generation)
            });
        let pending = PendingStop::default();
        let hotkey = Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap()).unwrap();
        let mut chord = PhysicalChord::new(hotkey);

        // When: one physical chord, including trigger auto-repeat, reaches the hook.
        for vk in [0xA2, 0xA4, 0xA0, 0x1B, 0x1B] {
            if chord.key(KeyEvent {
                vk,
                down: true,
                injected: false,
            }) == Outcome::Stop
            {
                pending.request(&supervisor);
            }
        }
        assert!(supervisor.is_suspended());
        assert!(supervisor.stop_pending());
        assert!(generations.lock().unwrap().is_empty());
        assert!(pending.complete(&supervisor));

        // Then: the worker covers the hook's generation, not a second request.
        assert_eq!(*generations.lock().unwrap(), [1]);
        assert!(!supervisor.stop_pending());
        assert!(!pending.complete(&supervisor));
        assert_eq!(*generations.lock().unwrap(), [1]);
    }
}
