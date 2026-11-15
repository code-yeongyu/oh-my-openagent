//! Engine-wide state shared by every connection: the one desktop session,
//! the supervisor and its (possibly fake) clock, the stop paths and resume
//! token, the notification outbox, and the request permits.

use std::sync::Arc;
use std::time::Instant;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::methods::{Effect, Method, Notification};
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::protocol::{ABI, FEATURES, PROTOCOL_VERSION};
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
use crate::trace::{op_method, TraceSink};

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
    stop_paths: Arc<StopPaths>,
    resume_token: String,
    shared_agent: bool,
    fake_clock: Option<Arc<FakeClock>>,
    outbox: Arc<Outbox>,
    /// The `trace: true` request trace; idle until such an open applies.
    trace: Arc<TraceSink>,
    read_permits: Arc<Semaphore>,
    /// One mutating request in flight at a time.
    exec_permits: Arc<Semaphore>,
    /// How long a cancelled hold may take to release its input (the configured close budget).
    hold_release_budget: std::time::Duration,
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
        let stop_paths = Arc::new(StopPaths::new(Arc::clone(&supervisor), &config.selection, resume));
        Self::start_bound(config, stop_paths, fake_clock, false)
    }

    fn start_bound(
        config: EngineConfig,
        stop_paths: Arc<StopPaths>,
        fake_clock: Option<Arc<FakeClock>>,
        shared_agent: bool,
    ) -> CoreResult<Self> {
        let factory = config.selection.clone();
        Self::start_factory(factory, config, stop_paths, fake_clock, shared_agent)
    }

    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn start_session(
        factory: impl senpi_desktop_session::BackendFactory,
        config: EngineConfig,
        stop_paths: Arc<StopPaths>,
    ) -> CoreResult<Self> {
        Self::start_factory(factory, config, stop_paths, None, true)
    }

    fn start_factory(
        factory: impl senpi_desktop_session::BackendFactory,
        config: EngineConfig,
        stop_paths: Arc<StopPaths>,
        fake_clock: Option<Arc<FakeClock>>,
        shared_agent: bool,
    ) -> CoreResult<Self> {
        let outbox = Arc::new(Outbox::default());
        let audited = Arc::clone(&outbox);
        let trace = Arc::new(TraceSink::new());
        let traced = Arc::clone(&trace);
        let safety = SessionSafety {
            supervisor: stop_paths.supervisor(),
            audit: Box::new(move |event| {
                audited.push(Notification::Audit, event);
                traced.audit(event);
            }),
            control_slot: stop_paths.control_slot(),
        };
        let hold_release_budget = config.timeouts.close;
        Ok(Self {
            hold_release_budget,
            session: Session::start_supervised(factory, config.timeouts, safety)?,
            resume_token: if shared_agent {
                format!("{}{}", Ulid::generate(), Ulid::generate())
            } else {
                stop_paths.resume_token().to_owned()
            },
            shared_agent,
            stop_paths,
            fake_clock,
            outbox,
            trace,
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
            features: Some(FEATURES.iter().map(|feature| (*feature).to_owned()).collect()),
        }
    }

    /// Answered from the session's cache, so a busy backend never delays it.
    pub fn capabilities(&self) -> DesktopCapabilities {
        self.stop_paths.report().stamp(self.session.capabilities())
    }

    pub fn stop_paths(&self) -> &StopPaths {
        &self.stop_paths
    }

    pub const fn shared_agent(&self) -> bool { self.shared_agent }

    pub fn outbox(&self) -> &Outbox {
        &self.outbox
    }

    /// Queues `stopPath.changed` when the stop-path status changed.
    pub fn announce_stop_path(&self) {
        if let Some(status) = self.stop_paths.transition() {
            self.outbox.push(Notification::StopPathChanged, &status);
        }
    }

    /// Queues `epoch.changed` for every epoch move the session saw.
    pub fn announce_epochs(&self) {
        for change in self.session.epoch_changes() {
            self.outbox.push(Notification::EpochChanged, &change);
        }
    }

    /// The installed fake clock, when `SENPI_DESKTOP_FAKE_CLOCK=1` set one.
    pub fn fake_clock(&self) -> Option<&FakeClock> {
        self.fake_clock.as_deref()
    }

    /// Whether `method`'s reply is an object-mode action report: the session
    /// thread last applied an open with `reportMode: "object"` and `method`
    /// mutates.
    pub fn reports_action(&self, method: Method) -> bool {
        method.reports_action() && self.session.report_mode() == ReportMode::Object
    }

    pub fn permits(&self, effect: Effect) -> Arc<Semaphore> {
        match effect {
            Effect::Read => Arc::clone(&self.read_permits),
            Effect::Exec => Arc::clone(&self.exec_permits),
        }
    }

    /// Enqueues `call` on the session thread now; the reply comes from
    /// [`Started::wait`].
    /// The configured close budget a cancelled hold may use to release its input.
    pub fn hold_release_budget(&self) -> std::time::Duration {
        self.hold_release_budget
    }

    pub fn begin(&self, call: SessionCall) -> Started {
        let (pending, kind) = match call {
            SessionCall::Open(options) => (
                self.session.open(options.clone()),
                // Reported now: the reply outlives `self`.
                Call::Open(Box::new(OpenReply {
                    resume_token: self.resume_token.clone(),
                    report: self.stop_paths.report(),
                    options,
                })),
            ),
            SessionCall::Close => (self.session.close(), Call::Close),
            SessionCall::Op(op) => {
                let method = op_method(&op);
                (self.session.submit(op), Call::Op(method))
            }
        };
        Started {
            pending,
            kind,
            trace: Arc::clone(&self.trace),
            began: Instant::now(),
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
    /// Applied to the trace once the session accepted them.
    options: DesktopSessionOptions,
}

enum Call {
    Open(Box<OpenReply>),
    Close,
    Op(Method),
}

/// An enqueued session request.
pub struct Started {
    pending: Pending,
    kind: Call,
    trace: Arc<TraceSink>,
    began: Instant,
}

impl Started {
    pub fn hold_signal(&self) -> Option<Arc<senpi_desktop_safety::HoldSignal>> {
        self.pending.hold_signal()
    }

    /// Whether `method`'s reply carries an action report: fixed per request,
    /// so an open applied after it started cannot re-shape it.
    pub fn reports_action(&self, method: Method) -> impl Fn() -> bool {
        let mode = self.pending.request_mode();
        move || method.reports_action() && mode.as_ref().is_some_and(|mode| mode.get() == ReportMode::Object)
    }

    /// # Errors
    /// The session's error for this request.
    pub async fn wait(self) -> Result<Value, Failure> {
        let response = self.pending.wait().await.map_err(Failure::Engine);
        match (self.kind, response) {
            (Call::Open(open), Ok(Response::Capabilities(capabilities))) => {
                self.trace.configure(&open.options);
                to_result(SessionOpenResult {
                    capabilities: open.report.stamp(capabilities),
                    resume_token: open.resume_token,
                })
            }
            (Call::Open(_), Ok(other)) => Err(Failure::Engine(DesktopError::internal(format!(
                "session.open answered {other:?}"
            )))),
            (Call::Close, response) => {
                if response.is_ok() {
                    self.trace.stop();
                }
                response.and_then(to_result)
            }
            (Call::Op(method), response) => {
                let outcome = response.and_then(to_result);
                self.trace.reply(method, self.began.elapsed(), &outcome);
                outcome
            }
            (Call::Open(_), Err(failure)) => Err(failure),
        }
    }
}
