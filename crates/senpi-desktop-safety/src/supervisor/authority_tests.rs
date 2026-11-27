use super::authority_test_support::{backend, input, proof, supervisor};
use super::{authority::MAX_GENERATION, StopSource};
use crate::{AuthorityResetError, ResumeToken};
use std::sync::atomic::Ordering;

#[test]
fn initial_authority_is_suspended_and_only_exact_activation_allows_input() {
    // Given: initial recovery enrollment, a live stop path, and old held work.
    let supervisor = supervisor(|_| {});
    let held = supervisor.hold_signal();
    let current = proof(&supervisor);
    let duplicate = proof(&supervisor);
    let mut backend = backend();
    assert!(supervisor.is_suspended());
    assert!(input(&supervisor, &mut backend).is_err());
    // When: a current, covered activation is consumed.
    supervisor.activate_authority(current).unwrap();
    // Then: fresh input succeeds, old holds and duplicate activation do not.
    input(&supervisor, &mut backend).unwrap();
    assert_eq!(backend.sink().ops().len(), 1);
    assert!(held.check(&supervisor).is_err());
    let epoch = supervisor.stop_epoch();
    assert_eq!(
        supervisor.activate_authority(duplicate),
        Err(AuthorityResetError::StaleStop)
    );
    assert_eq!(supervisor.stop_epoch(), epoch);
    assert!(!supervisor.is_suspended());
}

#[test]
fn another_supervisor_cannot_consume_the_activation() {
    // Given: two distinct authority owners at the same numeric generation.
    let first = supervisor(|_| {});
    let second = supervisor(|_| {});
    // When: the proof is delivered to the other supervisor.
    let result = second.activate_authority(proof(&first));
    // Then: neither owner's admission changes.
    assert_eq!(result, Err(AuthorityResetError::WrongSupervisor));
    assert!(first.is_suspended() && second.is_suspended());
}

#[test]
fn uncovered_generation_cannot_activate_and_old_proof_cannot_retarget() {
    // Given: a captured activation followed by a new immediate stop.
    let supervisor = supervisor(|_| {});
    let old = proof(&supervisor);
    supervisor.suspend_input();
    let uncovered = proof(&supervisor);
    // When: the newer generation has not yet completed release and commit.
    let result = supervisor.activate_authority(uncovered);
    // Then: only a new proof AFTER drain can activate, not an old retarget.
    assert_eq!(result, Err(AuthorityResetError::UncommittedStop));
    assert!(supervisor.stop_pending());
    supervisor.complete_stop(StopSource::Api);
    assert_eq!(
        supervisor.activate_authority(old),
        Err(AuthorityResetError::StaleStop)
    );
    supervisor.activate_authority(proof(&supervisor)).unwrap();
    assert!(!supervisor.is_suspended());
}

#[test]
fn authority_rejects_legacy_and_test_reset_bypasses() {
    // Given: an authority stop and a legitimate legacy host token.
    let supervisor = supervisor(|_| {});
    let token = ResumeToken::new("synthetic-resume".to_owned());
    // When: both legacy and test reset paths are attempted.
    supervisor.reset(token.redeem(token.as_str()).unwrap());
    supervisor.reset_for_test();
    // Then: authority admission remains stopped.
    assert!(supervisor.is_suspended());
    assert!(supervisor.status().suspended);
}

#[test]
fn maximum_generation_is_absorbing_and_never_activatable() {
    // Given: the final representable generation, immediately before exhaustion.
    let supervisor = supervisor(|_| {});
    let admission = supervisor.authority.as_ref().unwrap();
    admission
        .word
        .store(((MAX_GENERATION - 1) << 1) | 1, Ordering::SeqCst);
    admission
        .committed_through
        .store(MAX_GENERATION - 1, Ordering::SeqCst);
    let old = proof(&supervisor);
    // When: callbacks reach MAX and repeat there; the worker drains twice.
    supervisor.suspend_input();
    supervisor.suspend_input();
    supervisor.complete_stop(StopSource::Hotkey);
    let epoch = supervisor.stop_epoch();
    supervisor.complete_stop(StopSource::Hotkey);
    // Then: no wrap, activation or duplicate publication is possible.
    assert_eq!(admission.word.load(Ordering::SeqCst), u64::MAX);
    assert_eq!(supervisor.stop_epoch(), epoch);
    assert_eq!(
        supervisor.activate_authority(old),
        Err(AuthorityResetError::StaleStop)
    );
    assert_eq!(
        supervisor.activate_authority(proof(&supervisor)),
        Err(AuthorityResetError::Exhausted)
    );
    assert!(supervisor.is_suspended());
}

#[test]
fn concurrent_callbacks_advance_once_each_and_one_drain_covers_both() {
    // Given: two callback threads released by the same registered barrier.
    let supervisor = supervisor(|_| {});
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let callbacks: Vec<_> = (0..2)
        .map(|_| {
            let supervisor = std::sync::Arc::clone(&supervisor);
            let barrier = std::sync::Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                supervisor.suspend_input();
            })
        })
        .collect();
    // When: both callbacks finish, then one coalesced worker wakeup drains.
    barrier.wait();
    for callback in callbacks {
        callback.join().unwrap();
    }
    supervisor.complete_stop(StopSource::Hotkey);
    // Then: completion does not count either request a second time.
    let admission = supervisor.authority.as_ref().unwrap();
    assert_eq!(admission.word.load(Ordering::SeqCst), 5);
    assert_eq!(admission.committed_through.load(Ordering::SeqCst), 2);
    assert_eq!(supervisor.stop_epoch(), 1);
}

#[test]
fn failed_authority_commit_never_publishes_or_covers_the_request() {
    // Given: an active authority whose durable store fails to return normally.
    let supervisor = supervisor(|_| panic!("injected authority failure"));
    supervisor.activate_authority(proof(&supervisor)).unwrap();
    let epoch = supervisor.stop_epoch();
    // When: a stop cannot be acknowledged durably.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        supervisor.trigger_stop(StopSource::Api);
    }));
    // Then: refusal is immediate, but publication and coverage remain pending.
    assert!(result.is_err());
    assert!(supervisor.is_suspended() && supervisor.stop_pending());
    assert!(!supervisor.published_status().suspended);
    assert_eq!(supervisor.stop_epoch(), epoch);
    assert_eq!(
        supervisor.activate_authority(proof(&supervisor)),
        Err(AuthorityResetError::UncommittedStop)
    );
}
