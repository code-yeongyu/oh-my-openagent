//! The Wayland `Global` stop path: a GlobalShortcuts portal session that
//! binds the stop chord; `Activated` latches the supervisor. The session's
//! task beats the `Global` heartbeat every `HEARTBEAT_INTERVAL_MS` while the
//! session is open; a closed session takes the path down.

use std::sync::{mpsc, Arc};
use std::time::Duration;

use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use ashpd::desktop::Session;
use futures::StreamExt;
use parking_lot::{Condvar, Mutex};
use senpi_desktop_safety::{
    Chord, StopPathError, StopPathId, StopPathListener, StopSource, Supervisor, HEARTBEAT_INTERVAL_MS,
};
use tokio::sync::watch;
use zbus::zvariant::serialized::Context;
use zbus::zvariant::OwnedObjectPath;

use super::trigger::{preferred_trigger, STOP_SHORTCUT_ID};
use crate::portal::{portal_runtime, CLOSE_TIMEOUT};

/// `stopReason` when the portal is missing, refuses, or never answers;
/// Wayland input then needs `computer.allowHostRelayOnlyStop=true`.
pub const UNAVAILABLE: &str = "portal-global-shortcuts-unavailable";
/// A compositor may show a one-time consent dialog for the binding.
const BIND_TIMEOUT: Duration = Duration::from_secs(30);
const DESCRIPTION: &str = "Stop senpi desktop input";

fn unavailable() -> StopPathError {
    StopPathError::Unavailable {
        reason: UNAVAILABLE.to_owned(),
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Control {
    pub live: bool,
    /// `Activated` signals seen for this session, matching or not.
    pub seen: u64,
}

pub(crate) struct Shared {
    sup: Arc<Supervisor>,
    pub control: Mutex<Control>,
    pub changed: Condvar,
    shutdown: watch::Sender<bool>,
}

impl Shared {
    fn update(&self, change: impl FnOnce(&mut Control)) {
        change(&mut self.control.lock());
        self.changed.notify_all();
    }

    fn set_live(&self, live: bool) {
        self.sup.set_live(StopPathId::Global, live);
        self.update(|control| control.live = live);
    }
}

/// The GlobalShortcuts kill switch; one portal session per instance, closed
/// when the instance drops.
#[derive(Default)]
pub struct GlobalShortcutsListener {
    shared: Option<Arc<Shared>>,
    trigger: Option<String>,
}

impl GlobalShortcutsListener {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            shared: None,
            trigger: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn shared(&self) -> Option<&Shared> {
        self.shared.as_deref()
    }

    /// Opens a session and binds the trigger; returns once bound or refused.
    /// The bind result arrives on a std channel, so the caller never enters
    /// the portal runtime: `start` is safe from any thread, including the
    /// engine's own tokio workers.
    fn arm(&mut self, sup: Arc<Supervisor>, trigger: String) -> Result<(), StopPathError> {
        let runtime = portal_runtime().map_err(|_| unavailable())?;
        let (shutdown, shutdown_rx) = watch::channel(false);
        let shared = Arc::new(Shared {
            sup,
            control: Mutex::new(Control::default()),
            changed: Condvar::new(),
            shutdown,
        });
        let (ready, bound) = mpsc::sync_channel(1);
        let task = runtime.spawn(run(Arc::clone(&shared), trigger, ready, shutdown_rx));
        match bound.recv_timeout(BIND_TIMEOUT) {
            Ok(Ok(())) => {
                self.shared = Some(shared);
                Ok(())
            }
            Ok(Err(error)) => {
                eprintln!("senpi-desktop-backend-wayland: GlobalShortcuts: {error}");
                Err(unavailable())
            }
            Err(_) => {
                task.abort();
                shared.set_live(false);
                Err(unavailable())
            }
        }
    }
}

impl StopPathListener for GlobalShortcutsListener {
    /// Idempotent while live; otherwise opens a fresh session.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        let trigger = preferred_trigger(chord)?;
        if self.is_live() {
            return Ok(());
        }
        self.trigger = Some(trigger.clone());
        self.arm(sup, trigger)
    }

    fn is_live(&self) -> bool {
        self.shared
            .as_ref()
            .is_some_and(|shared| shared.control.lock().live)
    }

    /// Re-binds after the portal closed the session; a no-op before `start`.
    fn restart(&mut self) {
        if self.is_live() {
            return;
        }
        let Some((sup, trigger)) = self
            .shared
            .as_ref()
            .map(|shared| Arc::clone(&shared.sup))
            .zip(self.trigger.clone())
        else {
            return;
        };
        if let Err(error) = self.arm(sup, trigger) {
            eprintln!("senpi-desktop-backend-wayland: GlobalShortcuts re-arm failed: {error}");
        }
    }
}

impl Drop for GlobalShortcutsListener {
    fn drop(&mut self) {
        if let Some(shared) = &self.shared {
            shared.shutdown.send_replace(true);
        }
    }
}

type Ready = mpsc::SyncSender<Result<(), ashpd::Error>>;

/// The session's whole life: subscribe to `Activated` first so no signal is
/// missed, open the session, bind, report, then serve until closed.
async fn run(shared: Arc<Shared>, trigger: String, ready: Ready, mut shutdown: watch::Receiver<bool>) {
    let portal = match GlobalShortcuts::new().await {
        Ok(portal) => portal,
        Err(error) => return report(ready, Err(error)),
    };
    let activated = match portal.receive_activated().await {
        Ok(stream) => stream,
        Err(error) => return report(ready, Err(error)),
    };
    let session = match portal.create_session().await {
        Ok(session) => session,
        Err(error) => return report(ready, Err(error)),
    };
    let shortcut = NewShortcut::new(STOP_SHORTCUT_ID, DESCRIPTION).preferred_trigger(trigger.as_str());
    let bound = async {
        let closed = session_closed(&portal, &session).await?;
        portal
            .bind_shortcuts(&session, &[shortcut], None)
            .await?
            .response()?;
        Ok(closed)
    }
    .await;
    let closed = match bound {
        Ok(closed) => closed,
        Err(error) => {
            close(&session).await;
            return report(ready, Err(error));
        }
    };
    shared.set_live(true);
    report(ready, Ok(()));
    let (mut activated, mut closed) = (std::pin::pin!(activated), std::pin::pin!(closed));
    let mut beat = tokio::time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
    loop {
        tokio::select! {
            Some(activation) = activated.next() => {
                // xdg-desktop-portal delivers `Activated` to the session's
                // owner only, and this process holds one session: the id decides.
                if activation.shortcut_id() == STOP_SHORTCUT_ID {
                    shared.sup.trigger_stop(StopSource::Hotkey);
                }
                shared.update(|control| control.seen += 1);
            }
            _ = closed.next() => break,
            _ = beat.tick() => shared.sup.heartbeat(StopPathId::Global),
            _ = shutdown.changed() => break,
        }
    }
    shared.set_live(false);
    close(&session).await;
}

/// `Session.Closed` for `session`, subscribed on ashpd's own connection
/// (the portal unicasts it to the session owner). ashpd 0.11's
/// `Session::receive_closed` decodes the spec's `a{sv}` body as `()` and
/// drops every signal, so this matches the message itself.
async fn session_closed(
    portal: &GlobalShortcuts<'_>,
    session: &Session<'_, GlobalShortcuts<'_>>,
) -> Result<zbus::MessageStream, ashpd::Error> {
    // `Session` encodes as its object path (signature `o`) but keeps the
    // path accessor crate-private.
    let encoded = zbus::zvariant::to_bytes(Context::new_dbus(zbus::zvariant::LE, 0), session)?;
    let (path, _): (OwnedObjectPath, usize) = encoded.deserialize()?;
    let rule = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.freedesktop.portal.Session")?
        .member("Closed")?
        .path(path)?
        .build();
    Ok(zbus::MessageStream::for_match_rule(rule, portal.connection(), None).await?)
}

fn report(ready: Ready, outcome: Result<(), ashpd::Error>) {
    if ready.send(outcome).is_err() {
        eprintln!("senpi-desktop-backend-wayland: GlobalShortcuts bind finished after start gave up");
    }
}

async fn close(session: &Session<'_, GlobalShortcuts<'_>>) {
    match tokio::time::timeout(CLOSE_TIMEOUT, session.close()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("senpi-desktop-backend-wayland: GlobalShortcuts Close: {error}"),
        Err(_) => eprintln!("senpi-desktop-backend-wayland: GlobalShortcuts Close timed out"),
    }
}
