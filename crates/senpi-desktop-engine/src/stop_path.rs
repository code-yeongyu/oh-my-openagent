//! The engine's stop paths and the only way to lift a stop.
//!
//! `stopPath.start` arms the platform `Global` listener when the backend
//! provides one and always arms the [`HostRelay`]; nothing is armed by
//! `session.open`. `stopPath.resume` redeems the per-process resume token,
//! which only the `session.open` reply carries to the host that opened the
//! session. Status transitions are announced as `stopPath.changed`.

use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::protocol_params::StopRequestSource;
use senpi_desktop_core::protocol_results::{StopPathKind, StopPathStatus};
use senpi_desktop_core::types::DesktopCapabilities;
use senpi_desktop_safety::{
    ActiveStopPath, Chord, HostRelay, ResumeToken, StopPathListener, StopPolicy, StopSource, Supervisor,
    SupervisorStatus,
};
use senpi_desktop_session::BackendSelection;

use crate::fake_listener::FakeGlobalListener;

/// Reported as `stopReason` when no Global listener exists or none started.
const NO_GLOBAL_LISTENER: &str = "no-global-listener";

type Listener = Box<dyn StopPathListener + Send>;

/// The platform backend's Global listener; the fake backend has none (a fake
/// session relies on the host relay) unless the test asks for a live one.
fn global_listener(selection: &BackendSelection) -> Option<Listener> {
    match selection {
        BackendSelection::Platform => platform_listener(),
        BackendSelection::FakeFile(_) | BackendSelection::FakeScenario(_) => {
            FakeGlobalListener::from_env().map(|listener| Box::new(listener) as Listener)
        }
    }
}

#[cfg(target_os = "macos")]
fn platform_listener() -> Option<Listener> {
    Some(Box::new(senpi_desktop_backend_macos::CgEventTapListener::new()))
}

/// Mirrors the session's display-server choice: `WAYLAND_DISPLAY` wins over
/// `DISPLAY` (an XWayland session sets both), and no display means no listener.
#[cfg(target_os = "linux")]
fn platform_listener() -> Option<Listener> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        Some(Box::new(
            senpi_desktop_backend_wayland::GlobalShortcutsListener::new(),
        ))
    } else if std::env::var_os("DISPLAY").is_some() {
        Some(Box::new(senpi_desktop_backend_x11::Xi2Listener::new()))
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn platform_listener() -> Option<Listener> {
    Some(Box::new(senpi_desktop_backend_win32::HotkeyListener::new()))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
const fn platform_listener() -> Option<Listener> {
    None
}

/// The part of a status whose change is announced. Heartbeat freshness is
/// derived from time and is not a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Announced {
    suspended: bool,
    global_live: bool,
    host_relay_live: bool,
    stop_path: ActiveStopPath,
}

impl From<SupervisorStatus> for Announced {
    fn from(status: SupervisorStatus) -> Self {
        Self {
            suspended: status.suspended,
            global_live: status.global_live,
            host_relay_live: status.host_relay_live,
            stop_path: status.stop_path,
        }
    }
}

/// The stop-path fields of [`DesktopCapabilities`].
pub struct StopReport {
    stop_path: String,
    stop_reason: Option<String>,
}

impl StopReport {
    pub fn stamp(self, capabilities: DesktopCapabilities) -> DesktopCapabilities {
        DesktopCapabilities {
            stop_path: self.stop_path,
            stop_reason: self.stop_reason,
            ..capabilities
        }
    }
}

struct State {
    host_relay: HostRelay,
    global: Option<Listener>,
    /// Why the Global listener failed to start, when it did.
    global_failure: Option<String>,
    /// `computer.allowHostRelayOnlyStop` of the latest `session.open`.
    policy: StopPolicy,
    announced: Announced,
}

pub struct StopPaths {
    supervisor: Arc<Supervisor>,
    resume: ResumeToken,
    state: Mutex<State>,
}

impl StopPaths {
    pub fn new(supervisor: Arc<Supervisor>, selection: &BackendSelection, resume: ResumeToken) -> Self {
        let announced = Announced::from(supervisor.status());
        Self {
            state: Mutex::new(State {
                host_relay: HostRelay::new(),
                global: global_listener(selection),
                global_failure: None,
                policy: StopPolicy::default(),
                announced,
            }),
            supervisor,
            resume,
        }
    }

    pub fn resume_token(&self) -> &str {
        self.resume.as_str()
    }

    pub fn set_policy(&self, policy: StopPolicy) {
        self.state.lock().policy = policy;
    }

    /// `stopPath.start`: (re)starts the Global listener if there is one, then
    /// arms the host relay.
    pub fn start(&self, chord: &Chord) -> StopPathStatus {
        let mut state = self.state.lock();
        if let Some(global) = state.global.as_mut().filter(|global| !global.is_live()) {
            let started = global.start(chord, Arc::clone(&self.supervisor));
            state.global_failure = started.err().map(|error| error.reason().to_owned());
        }
        state.host_relay.arm(Arc::clone(&self.supervisor));
        drop(state);
        self.status()
    }

    /// `stopPath.heartbeat`.
    pub fn heartbeat(&self) {
        self.state.lock().host_relay.heartbeat();
    }

    /// `stopPath.stop`: latches suspension until `stopPath.resume`.
    pub fn stop(&self, source: StopRequestSource) -> StopPathStatus {
        self.supervisor.trigger_stop(match source {
            StopRequestSource::HostRelay => StopSource::HostRelay,
            StopRequestSource::Api => StopSource::Api,
        });
        self.status()
    }

    /// `stopPath.resume`.
    ///
    /// # Errors
    /// `PermissionDenied` unless `token` is this process's resume token.
    pub fn resume(&self, token: &str) -> Result<StopPathStatus, DesktopError> {
        let proof = self.resume.redeem(token).ok_or_else(|| {
            DesktopError::permission_denied(
                "stopPath.resume needs the resume token of the session.open reply; only the host holds it",
            )
        })?;
        self.supervisor.reset(proof);
        if let Some(global) = self.state.lock().global.as_mut() {
            global.restart();
        }
        Ok(self.status())
    }

    pub fn status(&self) -> StopPathStatus {
        let status = self.supervisor.status();
        let policy = self.state.lock().policy;
        StopPathStatus {
            suspended: status.suspended,
            global_live: status.global_live,
            host_relay_live: status.host_relay_live,
            heartbeat_fresh: status.heartbeat_fresh,
            stop_path: match status.stop_path {
                ActiveStopPath::Global => StopPathKind::Global,
                ActiveStopPath::HostRelay => StopPathKind::HostRelay,
                ActiveStopPath::None => StopPathKind::None,
            },
            reason: status
                .stop_path_unavailable(&policy)
                .map(|reason| reason.as_str().to_owned()),
        }
    }

    /// `capabilities().stopPath` and `stopReason` (why it is not `global`).
    pub fn report(&self) -> StopReport {
        let status = self.supervisor.status();
        let stop_reason = match status.stop_path {
            ActiveStopPath::Global => None,
            ActiveStopPath::HostRelay | ActiveStopPath::None => Some(
                self.state
                    .lock()
                    .global_failure
                    .clone()
                    .unwrap_or_else(|| NO_GLOBAL_LISTENER.to_owned()),
            ),
        };
        StopReport {
            stop_path: status.stop_path.as_str().to_owned(),
            stop_reason,
        }
    }

    /// The current status when it differs from the last one announced.
    pub fn transition(&self) -> Option<StopPathStatus> {
        let current = Announced::from(self.supervisor.status());
        let mut state = self.state.lock();
        if state.announced == current {
            return None;
        }
        state.announced = current;
        drop(state);
        Some(self.status())
    }
}
