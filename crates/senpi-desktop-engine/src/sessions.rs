//! Each approved anonymous connection owns one Engine; only stop/input are shared.
use crate::{config::EngineConfig, engine::Engine, rpc::Failure, stop_path::StopPaths};
use senpi_desktop_core::{error::CoreResult, methods::Method, protocol::MethodRejection};
use senpi_desktop_safety::{MonotonicClock, ResumeToken, Supervisor};
use senpi_desktop_session::{BackendFactory, BackendSelection};
use std::sync::Arc;

pub(crate) struct Sessions {
    stop_paths: Arc<StopPaths>,
    #[cfg(test)]
    started: std::sync::atomic::AtomicUsize,
}

impl Sessions {
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn stopped_before_connection(&self) -> bool {
        self.stop_paths.status().suspended
    }

    #[cfg(test)]
    pub(crate) fn new() -> Self {
        let supervisor = Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())));
        Self::with_supervisor(supervisor)
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn persistent(latch: crate::stop_latch::StopLatch) -> Self {
        let supervisor = Supervisor::with_stop_commit(
            Arc::new(MonotonicClock::new()), latch.is_stopped(), move || latch.commit_or_exit(),
        );
        Self::with_supervisor(Arc::new(supervisor))
    }

    pub(crate) fn with_supervisor(supervisor: Arc<Supervisor>) -> Self {
        #[cfg(not(test))]
        let selection = BackendSelection::Platform;
        #[cfg(test)]
        let selection = BackendSelection::FakeScenario(Box::default());
        Self {
            stop_paths: Arc::new(StopPaths::new(
                supervisor,
                &selection,
                ResumeToken::new(ulid::Ulid::generate().to_string()),
            )),
            #[cfg(test)]
            started: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub(crate) fn open(&self, config: EngineConfig) -> CoreResult<Arc<Engine>> {
        self.open_with(config.clone(), config.selection)
    }

    pub(crate) fn open_with(
        &self,
        config: EngineConfig,
        factory: impl BackendFactory,
    ) -> CoreResult<Arc<Engine>> {
        let engine = Engine::start_session(factory, config, Arc::new(self.stop_paths.session_view()))?;
        #[cfg(test)]
        self.started
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Arc::new(engine))
    }

    /// Called only on an O1-verified, capability-checked, approved frame.
    pub(crate) fn classify(&self, frame: &[u8]) -> Result<Method, Failure> {
        let frame = frame.trim_ascii();
        if frame.contains(&b'\n') || frame.contains(&b'\r') {
            return Err(Failure::InvalidRequest(
                "exactly one NDJSON frame is required".to_owned(),
            ));
        }
        let request = crate::connection::parse_request(frame).map_err(|(_, failure)| failure)?;
        Method::from_name(&request.method).ok_or(Failure::Rejected(MethodRejection::Unknown))
    }

    #[cfg(test)]
    pub(crate) fn started_count(&self) -> usize {
        self.started.load(std::sync::atomic::Ordering::SeqCst)
    }
}
