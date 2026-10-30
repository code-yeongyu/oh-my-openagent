use super::authority_test_support::{backend, input, proof, supervisor};
use super::StopSource;
use crate::{AuthorityResetError, GateError};
use std::{
    sync::{mpsc, Arc},
    thread,
    time::Duration,
};

#[derive(Clone, Copy)]
enum Step {
    LiftReady,
    Activate,
    StopReady,
    Stop,
}

#[test]
fn all_six_old_split_schedules_preserve_the_two_atomic_orders() {
    use Step::{Activate as C, LiftReady as L, Stop as S, StopReady as I};
    for schedule in [
        [L, C, I, S],
        [L, I, C, S],
        [L, I, S, C],
        [I, L, C, S],
        [I, L, S, C],
        [I, S, L, C],
    ] {
        // Given: one fixed captured proof, with both real transitions behind
        // registered channel barriers. Ready is not a split admission write.
        let supervisor = supervisor(|_| {});
        let pending = proof(&supervisor);
        let (lift_start, lift_started) = mpsc::channel();
        let (lift_ready, lift_ready_rx) = mpsc::channel();
        let (activate, activating) = mpsc::channel();
        let (activated, activation_rx) = mpsc::channel();
        let lifting = Arc::clone(&supervisor);
        let lift_thread = thread::spawn(move || {
            lift_started.recv_timeout(Duration::from_secs(5)).unwrap();
            lift_ready.send(()).unwrap();
            activating.recv_timeout(Duration::from_secs(5)).unwrap();
            activated.send(lifting.activate_authority(pending)).unwrap();
        });
        let (stop_start, stop_started) = mpsc::channel();
        let (stop_ready, stop_ready_rx) = mpsc::channel();
        let (stop, stopping) = mpsc::channel();
        let (stopped, stop_rx) = mpsc::channel();
        let stopping_supervisor = Arc::clone(&supervisor);
        let stop_thread = thread::spawn(move || {
            stop_started.recv_timeout(Duration::from_secs(5)).unwrap();
            stop_ready.send(()).unwrap();
            stopping.recv_timeout(Duration::from_secs(5)).unwrap();
            stopping_supervisor.suspend_input();
            stopped.send(()).unwrap();
        });
        let mut stop_returned = false;
        // When: each formerly split schedule drives the actual indivisible
        // operations. Durable work stays blocked until every immediate check.
        for step in schedule {
            match step {
                L => {
                    lift_start.send(()).unwrap();
                    lift_ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                I => {
                    stop_start.send(()).unwrap();
                    stop_ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                C => {
                    activate.send(()).unwrap();
                    let result = activation_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    assert_eq!(
                        result,
                        if stop_returned {
                            Err(AuthorityResetError::StaleStop)
                        } else {
                            Ok(())
                        }
                    );
                }
                S => {
                    stop.send(()).unwrap();
                    stop_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    stop_returned = true;
                }
            }
            if stop_returned {
                let mut backend = backend();
                assert!(supervisor.status().suspended);
                assert_eq!(input(&supervisor, &mut backend), Err(GateError::Suspended));
                assert!(backend.sink().ops().is_empty());
            }
        }
        lift_thread.join().unwrap();
        stop_thread.join().unwrap();
        // Then: neither atomic order reopens admission after callback return.
        assert!(supervisor.is_suspended());
        supervisor.complete_stop(StopSource::Hotkey);
        assert!(supervisor.is_suspended());
    }
}
