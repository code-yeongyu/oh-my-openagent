//! Ported from gajae-code `executor.rs` tests (`suspended_rejects...`,
//! `not_live_rejects`, `missing_accessibility_rejects`,
//! `stale_display_epoch_rejects_coordinate_action`,
//! `matching_epoch_allows_action`, `type_and_keypress_pass_the_gate`) onto a
//! fake [`PermissionGate`] / [`FrameContext`] and a real [`Supervisor`].

use std::sync::Arc;

use senpi_desktop_core::error::{DesktopError, ErrorCode};

use super::{gate, FrameContext, FrameId, GateError, LockState, PermissionGate, StopPathReason};
use crate::{
    action::MutatingAction,
    clock::FakeClock,
    supervisor::{StopPathId, StopPolicy, StopSource, Supervisor, HEARTBEAT_FRESH_MS},
};

struct FakePerms {
    granted: bool,
}

impl PermissionGate for FakePerms {
    fn input_granted(&self) -> bool {
        self.granted
    }
}

struct FakeFrames {
    lock: LockState,
    latest: Option<FrameId>,
}

impl FrameContext for FakeFrames {
    fn screen_locked(&self) -> LockState {
        self.lock
    }

    fn is_latest(&self, frame: &FrameId) -> bool {
        self.latest.as_ref() == Some(frame)
    }
}

/// Everything the gate reads. `Scene::with` starts from a passing state: the
/// given stop paths live and fresh, global-only policy, input granted,
/// unlocked, latest frame `f1`.
struct Scene {
    supervisor: Supervisor,
    clock: Arc<FakeClock>,
    policy: StopPolicy,
    perms: FakePerms,
    frames: FakeFrames,
}

impl Scene {
    fn with(live: &[StopPathId]) -> Self {
        let clock = Arc::new(FakeClock::new(10_000));
        let supervisor = Supervisor::new(clock.clone());
        for id in live {
            supervisor.set_live(*id, true);
        }
        Self {
            supervisor,
            clock,
            policy: StopPolicy::default(),
            perms: FakePerms { granted: true },
            frames: FakeFrames {
                lock: LockState::Unlocked,
                latest: Some(FrameId::new("f1")),
            },
        }
    }

    fn live() -> Self {
        Self::with(&[StopPathId::Global])
    }

    fn run(&self, action: MutatingAction, expected_frame: Option<&str>) -> Result<(), GateError> {
        let expected_frame = expected_frame.map(FrameId::new);
        gate(
            &action,
            &self.supervisor,
            &self.policy,
            &self.perms,
            &self.frames,
            expected_frame,
        )
    }
}

fn stop_path_unavailable(reason: StopPathReason) -> Result<(), GateError> {
    Err(GateError::StopPathUnavailable { reason })
}

#[test]
fn suspended_rejects() {
    // Given: a live supervisor that latched a stop
    let scene = Scene::live();
    scene.supervisor.trigger_stop(StopSource::Hotkey);

    // When / Then: suspension refuses a move
    assert_eq!(
        scene.run(MutatingAction::MoveMouse, None),
        Err(GateError::Suspended)
    );
}

#[test]
fn no_live_stop_path_rejects_with_no_global_listener() {
    // Given: no stop path registered, even with relay-only allowed
    let mut scene = Scene::with(&[]);
    scene.policy.allow_host_relay_only = true;

    // When / Then
    let result = scene.run(MutatingAction::Click, None);
    assert_eq!(result, stop_path_unavailable(StopPathReason::NoGlobalListener));
}

#[test]
fn stale_heartbeat_rejects_with_heartbeat_stale() {
    // Given: a live global listener whose heartbeat stopped
    let scene = Scene::live();
    scene.clock.advance(HEARTBEAT_FRESH_MS + 1);

    // When / Then
    let result = scene.run(MutatingAction::TypeText, None);
    assert_eq!(result, stop_path_unavailable(StopPathReason::HeartbeatStale));
}

#[test]
fn host_relay_only_rejects_unless_policy_allows_it() {
    // Given: only the host relay is live and fresh
    let mut scene = Scene::with(&[StopPathId::HostRelay]);

    // When: gated under the default policy, then with relay-only allowed
    let refused = scene.run(MutatingAction::Click, None);
    scene.policy.allow_host_relay_only = true;
    let allowed = scene.run(MutatingAction::Click, None);

    // Then: only the opt-in policy accepts the relay alone
    assert_eq!(
        refused,
        stop_path_unavailable(StopPathReason::HostRelayNotAllowed)
    );
    assert_eq!(allowed, Ok(()));
}

#[test]
fn stale_host_relay_rejects_with_heartbeat_stale_when_allowed() {
    // Given: only the host relay is live, relay-only allowed, its heartbeat stopped
    let mut scene = Scene::with(&[StopPathId::HostRelay]);
    scene.policy.allow_host_relay_only = true;
    scene.clock.advance(HEARTBEAT_FRESH_MS + 1);

    // When / Then
    let result = scene.run(MutatingAction::Click, None);
    assert_eq!(result, stop_path_unavailable(StopPathReason::HeartbeatStale));
}

#[test]
fn locked_screen_rejects() {
    // Given: the lock-screen probe reports locked
    let mut scene = Scene::live();
    scene.frames.lock = LockState::Locked;

    // When / Then
    assert_eq!(
        scene.run(MutatingAction::KeyChord, None),
        Err(GateError::ScreenLocked)
    );
}

#[test]
fn unknown_lock_state_counts_as_unlocked() {
    // Given: the lock-screen probe could not tell
    let mut scene = Scene::live();
    scene.frames.lock = LockState::Unknown;

    // When / Then
    assert_eq!(scene.run(MutatingAction::KeyChord, None), Ok(()));
}

#[test]
fn missing_permission_rejects() {
    // Given: input permission not granted
    let mut scene = Scene::live();
    scene.perms.granted = false;

    // When / Then
    assert_eq!(
        scene.run(MutatingAction::MoveMouse, None),
        Err(GateError::PermissionDenied)
    );
}

#[test]
fn stale_frame_rejects_only_coordinate_actions() {
    // Given: the latest capture is f1, every action expects f0
    let scene = Scene::live();
    let coordinate = [
        MutatingAction::Click,
        MutatingAction::MoveMouse,
        MutatingAction::Drag,
        MutatingAction::Scroll,
    ];

    for action in MutatingAction::ALL {
        // When
        let result = scene.run(action, Some("f0"));

        // Then: pixel-addressed actions refuse the stale frame; others ignore it
        let expected = if coordinate.contains(&action) {
            Err(GateError::InvalidCoordinateFrame)
        } else {
            Ok(())
        };
        assert_eq!(result, expected, "{action:?}");
    }
}

#[test]
fn matching_frame_allows_coordinate_action() {
    // Given: the expected frame is the latest capture
    let scene = Scene::live();

    // When / Then
    assert_eq!(scene.run(MutatingAction::Click, Some("f1")), Ok(()));
}

#[test]
fn gate_order_is_supervisor_then_permission_then_frame() {
    // Given: suspended, permission denied, and a stale expected frame at once
    let mut scene = Scene::live();
    scene.supervisor.trigger_stop(StopSource::Api);
    scene.perms.granted = false;

    // When
    let result = scene.run(MutatingAction::Click, Some("f0"));

    // Then: the supervisor check wins
    assert_eq!(result, Err(GateError::Suspended));
}

#[test]
fn gate_order_peels_one_failing_check_at_a_time() {
    // Given: no stop path, locked, permission denied, stale frame; each step
    // lifts the highest failing check
    let mut scene = Scene::with(&[]);
    scene.frames.lock = LockState::Locked;
    scene.perms.granted = false;
    let mut outcomes = vec![scene.run(MutatingAction::Drag, Some("f0"))];

    // When
    scene.supervisor.set_live(StopPathId::Global, true);
    outcomes.push(scene.run(MutatingAction::Drag, Some("f0")));
    scene.frames.lock = LockState::Unlocked;
    outcomes.push(scene.run(MutatingAction::Drag, Some("f0")));
    scene.perms.granted = true;
    outcomes.push(scene.run(MutatingAction::Drag, Some("f0")));

    // Then: stop path, then lock, then permission, then frame
    assert_eq!(
        outcomes,
        [
            stop_path_unavailable(StopPathReason::NoGlobalListener),
            Err(GateError::ScreenLocked),
            Err(GateError::PermissionDenied),
            Err(GateError::InvalidCoordinateFrame),
        ]
    );
}

#[test]
fn stop_path_rejection_converts_to_wire_error_with_reason_as_message() {
    // Given
    let error = GateError::StopPathUnavailable {
        reason: StopPathReason::HostRelayNotAllowed,
    };

    // When
    let wire = DesktopError::from(error);

    // Then
    assert_eq!(wire.code, ErrorCode::StopPathUnavailable);
    assert_eq!(wire.to_string(), "StopPathUnavailable: host-relay-not-allowed");
}
