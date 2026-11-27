//! The sway `Global` stop path: a sway IPC connection subscribed to binding
//! events latches the supervisor when a configured binding whose modifiers
//! and symbol match the stop chord executes. sway emits binding events only
//! for bindings the user's config declares, so the honest setup is one
//! `bindsym` line matching the chord, e.g. for the default chord:
//!
//! ```sway
//! bindsym Ctrl+Shift+Escape exec true
//! ```
//!
//! The subscription is live and heartbeats while the socket answers; a
//! socket that breaks marks the path not live (input refused) and the
//! listener parks until [`StopPathListener::restart`] reconnects it.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use senpi_desktop_core::keys::{parse_key, KeyName};
use senpi_desktop_safety::{
    Chord, StopPathError, StopPathId, StopPathListener, StopSource, Supervisor,
    HEARTBEAT_INTERVAL_MS,
};
use serde::Deserialize;

use crate::input::xkb_name;
use crate::ipc::{self, SwaySocket};

pub const STOP_PATH_UNAVAILABLE: &str = "sway-bind-unavailable";
const THREAD_NAME: &str = "senpi-desktop-sway-bind";
/// How long `start()` waits for the subscription to go live.
const START_TIMEOUT: Duration = Duration::from_secs(2);
const HEARTBEAT: Duration = Duration::from_millis(HEARTBEAT_INTERVAL_MS);

#[derive(Debug, Default)]
struct Control {
    live: bool,
    /// Connections that failed to open, and the last one's reason.
    failures: u64,
    failure: Option<String>,
    /// Binding events that latched a stop.
    stops: u64,
    /// Binding events processed, matched or not — the deterministic signal
    /// a negative test waits on before counting latches.
    events: u64,
    restart: bool,
    shutdown: bool,
}

struct Shared {
    supervisor: Arc<Supervisor>,
    chord: Mutex<BindChord>,
    control: Mutex<Control>,
    changed: Condvar,
}

impl Shared {
    fn update(&self, change: impl FnOnce(&mut Control)) {
        change(&mut self.control.lock());
        self.changed.notify_all();
    }

    fn set_live(&self, live: bool) {
        self.supervisor.set_live(StopPathId::Global, live);
        self.update(|control| control.live = live);
    }

    fn open_failed(&self, reason: &str) {
        self.supervisor.set_live(StopPathId::Global, false);
        self.update(|control| {
            control.live = false;
            control.failures = control.failures.saturating_add(1);
            control.failure = Some(reason.to_owned());
        });
    }

    fn request_restart(&self) {
        self.update(|control| control.restart = !control.live);
    }

    fn wait_restart(&self) -> bool {
        let mut control = self.control.lock();
        self.changed.wait_while(&mut control, |control| {
            !control.restart && !control.shutdown
        });
        control.restart = false;
        !control.shutdown
    }

    fn wait_live(&self, failures: u64, timeout: Duration) -> Result<(), StopPathError> {
        let mut control = self.control.lock();
        self.changed.wait_while_for(
            &mut control,
            |control| !control.live && control.failures == failures && !control.shutdown,
            timeout,
        );
        if control.live {
            return Ok(());
        }
        Err(StopPathError::Unavailable {
            reason: control
                .failure
                .clone()
                .unwrap_or_else(|| STOP_PATH_UNAVAILABLE.to_owned()),
        })
    }

    fn wait_shutdown(&self) {
        let mut control = self.control.lock();
        self.changed
            .wait_while(&mut control, |control| !control.shutdown);
    }
}

/// The chord as sway sees it: the modifiers of a `bindsym` and its keysym.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindChord {
    pub(crate) modifiers: Vec<KeyName>,
    pub(crate) symbol: String,
}

impl BindChord {
    /// # Errors
    /// [`StopPathError::InvalidChord`] unless the chord is modifiers plus
    /// exactly one key with an XKB keysym name.
    pub fn parse(chord: &Chord) -> Result<Self, StopPathError> {
        let invalid = || StopPathError::InvalidChord(chord.to_string());
        let mut modifiers = Vec::new();
        let mut symbol = None;
        for key in chord.keys() {
            let name = parse_key(key).map_err(|_| invalid())?;
            match name {
                KeyName::Ctrl
                | KeyName::Alt
                | KeyName::Shift
                | KeyName::Meta
                | KeyName::CapsLock => {
                    modifiers.push(name);
                }
                key => {
                    if symbol.is_some() {
                        return Err(invalid());
                    }
                    symbol = Some(
                        xkb_name(key)
                            .or_else(|| match key {
                                KeyName::Char(character) => Some(character.to_string()),
                                _ => None,
                            })
                            .ok_or_else(invalid)?,
                    );
                }
            }
        }
        Ok(Self {
            modifiers,
            symbol: symbol.ok_or_else(invalid)?,
        })
    }

    /// Whether a sway binding event matches: keyboard bindings only, the
    /// same modifier set, and the same symbol.
    #[must_use]
    pub fn matches(&self, event: &BindingEvent) -> bool {
        let Some(binding) = event.binding() else {
            return false;
        };
        if binding.input_type.as_deref() != Some("keyboard") {
            return false;
        }
        if binding.symbol.as_deref() != Some(self.symbol.as_str()) {
            return false;
        }
        let mut expected = self.modifiers.clone();
        expected.sort_by_key(|key| format!("{key:?}"));
        let mut seen = Vec::new();
        for name in &binding.event_state_mask {
            if let Some(modifier) = xkb_modifier(name) {
                seen.push(modifier);
            } else {
                // An unrecognized modifier (Mod2, Mod3...) is not part of the
                // chord, so the binding does not match exactly.
                return false;
            }
        }
        seen.sort_by_key(|key| format!("{key:?}"));
        seen == expected
    }
}

/// sway's `input_state_mask` names, in XKB modifier terms.
fn xkb_modifier(name: &str) -> Option<KeyName> {
    match name {
        "Shift" | "shift" => Some(KeyName::Shift),
        "Control" | "Ctrl" | "ctrl" => Some(KeyName::Ctrl),
        "Alt" | "Mod1" => Some(KeyName::Alt),
        "Super" | "Logo" | "Win" | "Mod4" => Some(KeyName::Meta),
        _ => None,
    }
}

/// One binding event; sway nests the binding fields under `binding`, older
/// revisions flattened them, so both shapes parse.
#[derive(Debug, Clone, Deserialize)]
pub struct BindingEvent {
    #[serde(default)]
    binding: Option<BindingFields>,
    #[serde(flatten)]
    flat: BindingFields,
}

impl BindingEvent {
    fn binding(&self) -> Option<BindingFields> {
        self.binding
            .clone()
            .or_else(|| (!self.flat.is_empty()).then(|| self.flat.clone()))
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct BindingFields {
    #[serde(default)]
    pub event_state_mask: Vec<String>,
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub input_type: Option<String>,
}

impl BindingFields {
    fn is_empty(&self) -> bool {
        self.event_state_mask.is_empty() && self.symbol.is_none() && self.input_type.is_none()
    }
}

/// One subscription lifetime: subscribe, serve binding events until the
/// socket breaks, heartbeating while it answers.
enum Run {
    OpenFailed,
    Died,
    Shutdown,
}

fn run_subscription(shared: &Shared, socket_path: &std::path::Path) -> Run {
    let mut connection = match SwaySocket::connect(socket_path) {
        Ok(connection) => connection,
        Err(error) => {
            shared.open_failed(&error.message);
            return Run::OpenFailed;
        }
    };
    if let Err(error) = ipc::subscribe(&mut connection, &["binding"]) {
        shared.open_failed(&error.message);
        return Run::OpenFailed;
    }
    // The event stream has no replies, so the heartbeat is the read timeout
    // waking the loop.
    if connection.set_event_read_timeout(HEARTBEAT).is_err() {
        shared.open_failed("sway event timeout could not be set");
        return Run::OpenFailed;
    }
    shared.set_live(true);
    let outcome = serve_events(&mut connection, shared);
    shared.set_live(false);
    outcome
}

fn serve_events(connection: &mut SwaySocket, shared: &Shared) -> Run {
    loop {
        if shared.control.lock().shutdown {
            return Run::Shutdown;
        }
        match connection.next_event() {
            Ok(Some(payload)) => {
                let Ok(event) = serde_json::from_slice::<BindingEvent>(&payload) else {
                    continue;
                };
                let chord = shared.chord.lock().clone();
                let matched = chord.matches(&event);
                if matched {
                    // The effect runs before its acknowledgment is published,
                    // so a waiter that observed the counters knows the latch
                    // has landed.
                    shared.supervisor.trigger_stop(StopSource::Hotkey);
                }
                shared.update(|control| {
                    control.events = control.events.saturating_add(1);
                    if matched {
                        control.stops = control.stops.saturating_add(1);
                    }
                });
            }
            Ok(None) => {
                shared.supervisor.heartbeat(StopPathId::Global);
            }
            Err(_) => return Run::Died,
        }
    }
}

fn run_listener(shared: &Shared, socket_path: std::path::PathBuf) {
    loop {
        match run_subscription(shared, &socket_path) {
            Run::Shutdown => return,
            Run::Died | Run::OpenFailed => {}
        }
        if !shared.wait_restart() {
            return;
        }
    }
}

/// The sway binding kill switch; one listener thread per instance, stopped
/// when the instance drops.
#[derive(Default)]
pub struct SwayBindListener {
    shared: Option<Arc<Shared>>,
}

impl SwayBindListener {
    #[must_use]
    pub const fn new() -> Self {
        Self { shared: None }
    }

    /// `start` on an explicit socket, so tests drive a fake compositor.
    pub(crate) fn start_on(
        &mut self,
        chord: BindChord,
        sup: Arc<Supervisor>,
        socket_path: std::path::PathBuf,
    ) -> Result<(), StopPathError> {
        let (shared, failures) = if let Some(shared) = &self.shared {
            *shared.chord.lock() = chord;
            let failures = shared.control.lock().failures;
            shared.request_restart();
            (Arc::clone(shared), failures)
        } else {
            let shared = Arc::new(Shared {
                supervisor: sup,
                chord: Mutex::new(chord),
                control: Mutex::new(Control::default()),
                changed: Condvar::new(),
            });
            let listener = Arc::clone(&shared);
            thread::Builder::new()
                .name(THREAD_NAME.to_owned())
                .spawn(move || run_listener(&listener, socket_path))
                .map_err(|_| StopPathError::Unavailable {
                    reason: "sway-bind-thread-unavailable".to_owned(),
                })?;
            self.shared = Some(Arc::clone(&shared));
            (shared, 0)
        };
        shared.wait_live(failures, START_TIMEOUT)
    }
}

impl StopPathListener for SwayBindListener {
    /// Idempotent while live; a later call replaces the chord.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        let bind = BindChord::parse(chord)?;
        let socket = crate::sway_socket_path(&|name| std::env::var_os(name)).ok_or_else(|| {
            StopPathError::Unavailable {
                reason: "sway-socket-missing".to_owned(),
            }
        })?;
        self.start_on(bind, sup, socket)
    }

    fn is_live(&self) -> bool {
        self.shared
            .as_ref()
            .is_some_and(|shared| shared.control.lock().live)
    }

    /// Reconnects a listener whose socket broke; a no-op before `start`.
    fn restart(&mut self) {
        if let Some(shared) = &self.shared {
            shared.request_restart();
        }
    }
}

impl Drop for SwayBindListener {
    fn drop(&mut self) {
        if let Some(shared) = self.shared.take() {
            shared.update(|control| control.shutdown = true);
            shared.wait_shutdown();
        }
    }
}

#[cfg(test)]
impl SwayBindListener {
    /// Waits until the listener latched `count` stops.
    pub(crate) fn wait_stops(&self, count: u64, timeout: Duration) -> bool {
        let Some(shared) = &self.shared else {
            return count == 0;
        };
        let mut control = shared.control.lock();
        shared
            .changed
            .wait_while_for(&mut control, |control| control.stops < count, timeout);
        control.stops >= count
    }

    /// Waits until the listener processed `count` binding events, matched or
    /// not — the deterministic acknowledgment a negative test waits on
    /// before asserting what did or did not latch.
    pub(crate) fn wait_events(&self, count: u64, timeout: Duration) -> bool {
        let Some(shared) = &self.shared else {
            return count == 0;
        };
        let mut control = shared.control.lock();
        shared
            .changed
            .wait_while_for(&mut control, |control| control.events < count, timeout);
        control.events >= count
    }

    /// The stops latched so far; a stable read after [`Self::wait_events`].
    pub(crate) fn stops(&self) -> u64 {
        self.shared
            .as_ref()
            .map_or(0, |shared| shared.control.lock().stops)
    }
}
