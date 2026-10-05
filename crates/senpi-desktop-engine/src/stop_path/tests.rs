use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_safety::{
    gate, FakeClock, FrameContext, FrameId, LockState, MutatingAction, PermissionGate, StopPathError,
};

use super::*;

struct DeniedListener;

impl StopPathListener for DeniedListener {
    fn start(&mut self, _: &Chord, _: Arc<Supervisor>) -> Result<(), StopPathError> {
        Err(StopPathError::PermissionDenied("accessibility missing".to_owned()))
    }

    fn is_live(&self) -> bool {
        false
    }

    fn restart(&mut self) {}
}

struct View;
impl PermissionGate for View {
    fn input_granted(&self) -> bool {
        false
    }
}
impl FrameContext for View {
    fn screen_locked(&self) -> LockState {
        LockState::Unlocked
    }
    fn is_latest(&self, _: &FrameId) -> bool {
        true
    }
}

#[test]
fn accessibility_denied_stop_path_is_a_permission_error() {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    let paths = StopPaths::new(
        supervisor.clone(),
        &BackendSelection::Platform,
        ResumeToken::new("test-resume".to_owned()),
    );
    paths.state.lock().global = Some(Box::new(DeniedListener));

    let status = paths.start(&Chord::parse("ctrl+alt+shift+escape").unwrap());
    let refused = gate(
        &MutatingAction::Click,
        &supervisor,
        &StopPolicy::default(),
        &View,
        &View,
        None,
    );

    assert!(status.host_relay_live);
    assert_eq!(supervisor.status().global_failure, Some(StopPathFailure::AccessibilityDenied));
    assert_eq!(status.stop_path, StopPathKind::HostRelay);
    assert!(refused.is_err(), "permission failure must never authorize input");
    assert_eq!(refused.unwrap_err().code(), ErrorCode::PermissionDenied);
    assert_eq!(status.reason.as_deref(), Some("accessibility-denied"));
}

#[test]
fn successful_start_clears_the_previous_global_failure() {
    struct Live;
    impl StopPathListener for Live {
        fn start(&mut self, _: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
            sup.set_live(senpi_desktop_safety::StopPathId::Global, true);
            Ok(())
        }
        fn is_live(&self) -> bool { false }
        fn restart(&mut self) {}
    }
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    let paths = StopPaths::new(supervisor.clone(), &BackendSelection::Platform, ResumeToken::new("test".into()));
    paths.state.lock().global = Some(Box::new(DeniedListener));
    let chord = Chord::parse("ctrl+alt+shift+escape").unwrap();
    paths.start(&chord);
    paths.state.lock().global = Some(Box::new(Live));
    let status = paths.start(&chord);
    assert!(status.global_live);
    assert_eq!(supervisor.status().global_failure, None);
    assert_eq!(status.reason, None);
}
