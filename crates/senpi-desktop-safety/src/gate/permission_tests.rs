use std::sync::Arc;

use super::*;
use crate::{FakeClock, StopPathId, StopSource, HEARTBEAT_FRESH_MS};

struct View(bool);
impl PermissionGate for View {
    fn input_granted(&self) -> bool { self.0 }
}
impl FrameContext for View {
    fn screen_locked(&self) -> LockState { LockState::Unlocked }
    fn is_latest(&self, _: &FrameId) -> bool { true }
}

fn check(supervisor: &Supervisor, allow_relay: bool, granted: bool) -> Result<(), GateError> {
    gate(&MutatingAction::Click, supervisor, &StopPolicy { allow_host_relay_only: allow_relay },
        &View(granted), &View(granted), None)
}

fn denied() -> GateError {
    GateError::PermissionDenied { permission: TccPermission::Accessibility }
}

fn failed_global(relay: bool) -> (Supervisor, Arc<FakeClock>) {
    let clock = Arc::new(FakeClock::new(0));
    let supervisor = Supervisor::new(clock.clone());
    supervisor.note_global_failure(Some(StopPathFailure::AccessibilityDenied));
    supervisor.set_live(StopPathId::HostRelay, relay);
    (supervisor, clock)
}

#[test]
fn accessibility_denial_without_any_listener_never_allows_input() {
    let (supervisor, _) = failed_global(false);
    let result = check(&supervisor, false, true);
    assert!(result.is_err());
    assert_eq!(result, Err(denied()));
}

#[test]
fn accessibility_denial_with_live_host_relay_never_allows_default_input() {
    let (supervisor, _) = failed_global(true);
    let result = check(&supervisor, false, true);
    assert!(result.is_err());
    assert_eq!(result, Err(denied()));
}

#[test]
fn explicitly_allowed_relay_and_granted_input_still_work() {
    let (supervisor, _) = failed_global(true);
    assert_eq!(check(&supervisor, true, true), Ok(()));
}

#[test]
fn explicitly_allowed_relay_does_not_bypass_input_permission() {
    let (supervisor, _) = failed_global(true);
    assert_eq!(check(&supervisor, true, false), Err(denied()));
}

#[test]
fn suspended_still_precedes_accessibility_denial() {
    let (supervisor, _) = failed_global(true);
    supervisor.trigger_stop(StopSource::Api);
    assert_eq!(check(&supervisor, false, false), Err(GateError::Suspended));
}

#[test]
fn stale_accepted_relay_still_reports_heartbeat_stale() {
    let (supervisor, clock) = failed_global(true);
    clock.advance(HEARTBEAT_FRESH_MS + 1);
    assert_eq!(check(&supervisor, true, true),
        Err(GateError::StopPathUnavailable { reason: StopPathReason::HeartbeatStale }));
}

#[test]
fn unavailable_listener_retains_its_generic_classification() {
    let (supervisor, _) = failed_global(true);
    supervisor.note_global_failure(Some(StopPathFailure::Unavailable));
    assert_eq!(check(&supervisor, false, true),
        Err(GateError::StopPathUnavailable { reason: StopPathReason::HostRelayNotAllowed }));
}
