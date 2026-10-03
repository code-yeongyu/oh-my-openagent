//! Engine-wide state shared by every connection: the one desktop session,
//! the supervisor and its (possibly fake) clock, the stop paths and resume
//! token, the notification outbox, and the request permits.

use std::sync::Arc;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::methods::{Effect, Notification};
use senpi_desktop_core::protocol::{ABI, PROTOCOL_VERSION};
use senpi_desktop_core::protocol_results::{HelloResult, SessionOpenResult};
use senpi_desktop_core::types::{DesktopCapabilities, DesktopSessionOptions};
use senpi_desktop_safety::{Clock, FakeClock, MonotonicClock, ResumeToken, Supervisor};
use senpi_desktop_session::{Op, Pending, Response, Session, SessionSafety};
use serde_json::Value;
use tokio::sync::Semaphore;
use ulid::Ulid;

use crate::config::EngineConfig;
use crate::outbox::Outbox;
use crate::rpc::{to_result, Failure};
use crate::stop_path::{StopPaths, StopReport};

/// Read-only session requests that may be in flight at once.
pub const READ_CONCURRENCY: usize = 4;

/// A request the session thread serves, in submission order.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionCall {
    Open(DesktopSessionOptions),
    Close,
    Op(Op),
}

pub struct Engine {
    session: Session,
    stop_paths: StopPaths,
    fake_clock: Option<Arc<FakeClock>>,
    outbox: Arc<Outbox>,
    read_permits: Arc<Semaphore>,
    /// One mutating request in flight at a time.
    exec_permits: Arc<Semaphore>,
}

impl Engine {
    /// Selects the backend and starts the session thread.
    ///
    /// # Errors
    /// `Internal` when the session thread cannot start.
    pub fn start(config: EngineConfig) -> CoreResult<Self> {
        let fake_clock = config.fake_clock.then(|| Arc::new(FakeClock::new(0)));
        let clock: Arc<dyn Clock> = match &fake_clock {
            Some(fake) => Arc::clone(fake) as Arc<dyn Clock>,
            None => Arc::new(MonotonicClock::new()),
        };
        let supervisor = Arc::new(Supervisor::new(clock));
        // Per-process and random; only the `session.open` reply carries it.
        let resume = ResumeToken::new(format!("{}{}", Ulid::generate(), Ulid::generate()));
        let stop_paths = StopPaths::new(Arc::clone(&supervisor), &config.selection, resume);
        let outbox = Arc::new(Outbox::default());
        let audited = Arc::clone(&outbox);
        let safety = SessionSafety {
            supervisor,
            audit: Box::new(move |event| audited.push(Notification::Audit, event)),
        };
        Ok(Self {
            session: Session::start_supervised(config.selection, config.timeouts, safety)?,
            stop_paths,
            fake_clock,
            outbox,
            read_permits: Arc::new(Semaphore::new(READ_CONCURRENCY)),
            exec_permits: Arc::new(Semaphore::new(1)),
        })
    }

    pub fn hello() -> HelloResult {
        HelloResult {
            protocol_version: PROTOCOL_VERSION.to_owned(),
            engine_version: env!("CARGO_PKG_VERSION").to_owned(),
            build_sha: option_env!("SENPI_DESKTOP_BUILD_SHA")
                .unwrap_or("unknown")
                .to_owned(),
            abi: ABI.to_owned(),
        }
    }

    /// Answered from the session's cache, so a busy backend never delays it.
    pub fn capabilities(&self) -> DesktopCapabilities {
        self.stop_paths.report().stamp(self.session.capabilities())
    }

    pub const fn stop_paths(&self) -> &StopPaths {
        &self.stop_paths
    }

    pub fn outbox(&self) -> &Outbox {
        &self.outbox
    }

    /// Queues `stopPath.changed` when the stop-path status changed.
    pub fn announce_stop_path(&self) {
        if let Some(status) = self.stop_paths.transition() {
            self.outbox.push(Notification::StopPathChanged, &status);
        }
    }

    /// The installed fake clock, when `SENPI_DESKTOP_FAKE_CLOCK=1` set one.
    pub fn fake_clock(&self) -> Option<&FakeClock> {
        self.fake_clock.as_deref()
    }

    pub fn permits(&self, effect: Effect) -> Arc<Semaphore> {
        match effect {
            Effect::Read => Arc::clone(&self.read_permits),
            Effect::Exec => Arc::clone(&self.exec_permits),
        }
    }

    /// Enqueues `call` on the session thread now; the reply comes from
    /// [`Started::wait`].
    pub fn begin(&self, call: SessionCall) -> Started {
        match call {
            SessionCall::Open(options) => Started {
                pending: self.session.open(options),
                // Reported now: the reply outlives `self`.
                open: Some(OpenReply {
                    resume_token: self.stop_paths.resume_token().to_owned(),
                    report: self.stop_paths.report(),
                }),
            },
            SessionCall::Close => Started {
                pending: self.session.close(),
                open: None,
            },
            SessionCall::Op(op) => Started {
                pending: self.session.submit(op),
                open: None,
            },
        }
    }

    /// Closes the session at the end of the engine's life.
    pub async fn shutdown(&self) {
        if let Err(error) = self.session.close().wait().await {
            eprintln!("senpi-desktop-engine: closing the desktop session failed: {error}");
        }
    }
}

/// What the `session.open` reply adds to the session's capabilities.
struct OpenReply {
    resume_token: String,
    report: StopReport,
}

/// An enqueued session request.
pub struct Started {
    pending: Pending,
    /// `Some` for `session.open`.
    open: Option<OpenReply>,
}

impl Started {
    /// # Errors
    /// The session's error for this request.
    pub async fn wait(self) -> Result<Value, Failure> {
        let response = self.pending.wait().await.map_err(Failure::Engine)?;
        match (self.open, response) {
            (Some(open), Response::Capabilities(capabilities)) => to_result(SessionOpenResult {
                capabilities: open.report.stamp(capabilities),
                resume_token: open.resume_token,
            }),
            (Some(_), other) => Err(Failure::Engine(DesktopError::internal(format!(
                "session.open answered {other:?}"
            )))),
            (None, response) => to_result(response),
        }
    }
}
