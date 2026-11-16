use super::Supervisor;
use crate::{
    gate, AuthorityReset, FakeClock, FrameContext, FrameId, GateError, LockState, MutatingAction,
    PermissionGate, StopPathId, StopPolicy,
};
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario};
use senpi_desktop_core::{
    backend::{Backend, DeliveryMode},
    types::Target,
};
use std::sync::{atomic::Ordering, Arc};

pub(super) fn supervisor(commit: impl Fn(u64) + Send + Sync + 'static) -> Arc<Supervisor> {
    let supervisor = Arc::new(Supervisor::with_stop_authority(
        Arc::new(FakeClock::new(0)),
        commit,
    ));
    supervisor.set_live(StopPathId::Global, true);
    supervisor
}

/// Only the local transition is under test. This does not simulate or prove
/// broker authentication; no equivalent production proof minter exists yet.
pub(super) fn proof(supervisor: &Supervisor) -> AuthorityReset {
    let admission = Arc::clone(supervisor.authority.as_ref().unwrap());
    let stopped_word = admission.word.load(Ordering::SeqCst);
    AuthorityReset {
        admission,
        stopped_word,
    }
}

struct Ready;
impl PermissionGate for Ready {
    fn input_granted(&self) -> bool {
        true
    }
}
impl FrameContext for Ready {
    fn screen_locked(&self) -> LockState {
        LockState::Unlocked
    }
    fn is_latest(&self, _: &FrameId) -> bool {
        true
    }
}

pub(super) fn backend() -> FakeBackend {
    FakeBackend::new(FakeScenario::default())
}

pub(super) fn input(supervisor: &Supervisor, backend: &mut FakeBackend) -> Result<(), GateError> {
    gate(
        &MutatingAction::TypeText,
        supervisor,
        &StopPolicy::default(),
        &Ready,
        &Ready,
        None,
    )?;
    backend
        .type_text(&Target::Desktop, "synthetic", DeliveryMode::Foreground)
        .unwrap();
    Ok(())
}
