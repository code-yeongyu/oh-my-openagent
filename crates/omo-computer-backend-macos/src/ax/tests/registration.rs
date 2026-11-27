//! Observer registration (review M1): the caller's answer and the AX thread's kept set agree,
//! and an already-kept pid is not registered again.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use crate::ax::registration::{Kept, Registration};

const FAR: Duration = Duration::from_secs(600);

/// Counts how many made observers were released.
struct Probe(Rc<Cell<u32>>);

impl Drop for Probe {
    fn drop(&mut self) {
        self.0.set(self.0.get() + 1);
    }
}

#[test]
fn answer_given_in_time_is_the_callers_and_the_observer_is_kept() {
    let mut kept = Kept::default();
    let registration = Registration::new(Instant::now() + FAR);
    let made = kept.register(7, &registration, |r| {
        assert!(
            r.left().is_some_and(|l| l <= FAR),
            "each IPC is bounded by the wait"
        );
        Some("observer")
    });
    assert_eq!(made, Some(&"observer"));
    assert!(registration.wait());
    assert!(kept.contains(7));
}

#[test]
fn caller_giving_up_mid_registration_keeps_nothing() {
    let released = Rc::new(Cell::new(0));
    let mut kept = Kept::default();
    let registration = Registration::new(Instant::now() + FAR);
    let made = kept.register(7, &registration, |r| {
        // The slow app answers only after the caller stopped waiting.
        r.abandon();
        Some(Probe(Rc::clone(&released)))
    });
    assert!(made.is_none());
    assert!(!registration.wait(), "the caller answered false ...");
    assert!(!kept.contains(7), "... so the thread keeps no observer");
    assert_eq!(
        released.get(),
        1,
        "the late observer is released, not leaked"
    );
}

#[test]
fn overdue_request_makes_no_observer() {
    let mut kept: Kept<()> = Kept::default();
    let registration = Registration::new(Instant::now());
    assert!(
        !registration.wait(),
        "past its deadline the caller answers false"
    );
    let made = kept.register(7, &registration, |_| {
        panic!("no IPC for an abandoned request")
    });
    assert!(made.is_none());
    assert!(kept.is_empty());
}

#[test]
fn already_kept_pid_answers_true_without_a_second_observer() {
    let mut kept = Kept::default();
    let first = Registration::new(Instant::now() + FAR);
    assert!(kept.register(7, &first, |_| Some(1)).is_some());
    let again = Registration::new(Instant::now() + FAR);
    let made = kept.register(7, &again, |_| panic!("a kept pid is not registered again"));
    assert!(made.is_none());
    assert!(again.wait());
    assert_eq!(kept.len(), 1);
}

#[test]
fn refused_registration_answers_false_and_a_retry_can_keep() {
    let mut kept = Kept::default();
    let refused = Registration::new(Instant::now() + FAR);
    assert!(kept.register(7, &refused, |_| None::<u8>).is_none());
    assert!(!refused.wait());
    assert!(!kept.contains(7));
    let retry = Registration::new(Instant::now() + FAR);
    assert!(kept.register(7, &retry, |_| Some(1)).is_some());
    assert!(retry.wait());
}

#[test]
fn caller_on_another_thread_reads_the_threads_answer() {
    let (send, requests) = channel::<Registration>();
    let thread = std::thread::spawn(move || {
        let mut kept = Kept::default();
        let registration = requests.recv().ok()?;
        kept.register(7, &registration, |_| Some(())).copied()
    });
    let registration = Registration::new(Instant::now() + FAR);
    assert!(send.send(registration.clone()).is_ok());
    assert!(
        registration.wait(),
        "the waiting caller wakes on the thread's answer"
    );
    assert_eq!(thread.join().ok().flatten(), Some(()));
}
