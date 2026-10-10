//! A fake `org.freedesktop.portal.Desktop` on a private `dbus-daemon`
//! spawned by the test process itself (self-contained `cargo test`; the
//! wrapper shell kills the daemon and removes its directory when the test
//! process exits and closes the wrapper's stdin). It implements
//! `GlobalShortcuts` `CreateSession/BindShortcuts/Activated` and
//! `RemoteDesktop` `CreateSession/SelectDevices/Start/ConnectToEIS`, and
//! `Screenshot`, each scripted by [`Mode`].

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use tokio::runtime::Runtime;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

use super::fake_eis::{EisConfig, FakeEis};
use super::portal_ifaces::{GlobalShortcutsPortal, RemoteDesktopPortal};
use super::screenshot_iface::ScreenshotPortal;

const DESKTOP_PATH: &str = "/org/freedesktop/portal/desktop";

/// How one portal interface answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    /// Every request succeeds (`response=0`).
    Grant,
    /// The user refuses: the decisive request answers `response=1`.
    Deny,
    /// The interface is not implemented (`version` is `InvalidArgs`).
    Absent,
}

/// How the Screenshot interface answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shot {
    /// A fresh `width` x `height` PNG file per request.
    Png { width: u32, height: u32 },
    /// `response=1`.
    Deny,
    /// The interface is not implemented.
    Absent,
}

pub struct Mode {
    pub remote_desktop: Reply,
    pub global_shortcuts: Reply,
    pub screenshot: Shot,
    pub eis: EisConfig,
}

#[derive(Default)]
pub struct Recorded {
    /// `(id, preferred_trigger)` of every `BindShortcuts` shortcut.
    pub bound: Vec<(String, Option<String>)>,
    pub shortcuts_session: Option<String>,
    pub eis: Option<FakeEis>,
    /// Every PNG a `Screenshot` request wrote.
    pub shots: Vec<std::path::PathBuf>,
    /// The `interactive` option of the last `Screenshot` request.
    pub interactive: Option<bool>,
}

pub struct State {
    pub mode: Mutex<Mode>,
    pub recorded: Mutex<Recorded>,
}

impl State {
    pub fn mode(&self) -> std::sync::MutexGuard<'_, Mode> {
        self.mode.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn recorded(&self) -> std::sync::MutexGuard<'_, Recorded> {
        self.recorded.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Serves a `ConnectToEIS` socket with the fake EIS server.
    pub fn connect_eis(&self) -> std::io::Result<UnixStream> {
        let (client, server) = UnixStream::pair()?;
        let config = self.mode().eis;
        self.recorded().eis = Some(FakeEis::serve(server, config));
        Ok(client)
    }
}

pub struct FakeBus {
    _daemon: Child,
    runtime: Runtime,
    connection: zbus::Connection,
    pub state: Arc<State>,
}

static BUS: OnceLock<FakeBus> = OnceLock::new();

/// The process-wide fake bus; the caller holds `env_lock()`, because the
/// first call points `DBUS_SESSION_BUS_ADDRESS` at it.
pub fn fake_bus(mode: Mode) -> &'static FakeBus {
    let bus = BUS.get_or_init(start);
    *bus.state.mode() = mode;
    *bus.state.recorded() = Recorded::default();
    bus
}

fn start() -> FakeBus {
    let dir = tempfile::Builder::new()
        .prefix("senpi-wayland-bus-")
        .tempdir()
        .expect("bus dir")
        .keep();
    let config = dir.join("bus.conf");
    std::fs::write(&config, bus_config(&dir.join("bus").display().to_string())).expect("bus config");
    // `$!` is the daemon itself; the wrapper then drops its own stdout so a
    // daemon that fails to start closes the pipe (EOF) instead of hanging.
    let script = "dbus-daemon --config-file=\"$1\" --nofork --print-address=1 & pid=$!; \
                  exec 1>&-; read _; kill $pid; rm -rf \"$2\"";
    let mut daemon = Command::new("sh")
        .args(["-c", script, "sh"])
        .arg(&config)
        .arg(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn dbus-daemon wrapper");
    let mut address = String::new();
    BufReader::new(daemon.stdout.take().expect("daemon stdout"))
        .read_line(&mut address)
        .expect("read bus address");
    let address = address.trim().to_owned();
    assert!(
        address.starts_with("unix:"),
        "dbus-daemon did not start: {address:?}"
    );
    std::env::set_var("DBUS_SESSION_BUS_ADDRESS", &address);
    let state = Arc::new(State {
        mode: Mutex::new(Mode {
            remote_desktop: Reply::Absent,
            global_shortcuts: Reply::Absent,
            screenshot: Shot::Absent,
            eis: EisConfig { keymap: "", group: 0 },
        }),
        recorded: Mutex::default(),
    });
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("fake portal runtime");
    let connection = runtime
        .block_on(async {
            zbus::connection::Builder::address(address.as_str())?
                .name("org.freedesktop.portal.Desktop")?
                .serve_at(DESKTOP_PATH, RemoteDesktopPortal::new(Arc::clone(&state)))?
                .serve_at(DESKTOP_PATH, GlobalShortcutsPortal::new(Arc::clone(&state)))?
                .serve_at(DESKTOP_PATH, ScreenshotPortal::new(Arc::clone(&state)))?
                .build()
                .await
        })
        .expect("fake portal connection");
    FakeBus {
        _daemon: daemon,
        runtime,
        connection,
        state,
    }
}

fn bus_config(socket: &str) -> String {
    format!(
        r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path={socket}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#
    )
}

impl FakeBus {
    /// Emits `GlobalShortcuts.Activated` for the last bound session.
    pub fn activate(&self, shortcut_id: &str) {
        let session = self
            .state
            .recorded()
            .shortcuts_session
            .clone()
            .expect("a bound session");
        let session = ObjectPath::try_from(session.as_str()).expect("session path");
        let options: HashMap<&str, Value<'_>> = HashMap::new();
        self.runtime
            .block_on(self.connection.emit_signal(
                None::<&str>,
                DESKTOP_PATH,
                "org.freedesktop.portal.GlobalShortcuts",
                "Activated",
                &(session, shortcut_id, 0_u64, options),
            ))
            .expect("emit Activated");
    }

    /// Emits `Session.Closed` on the last bound GlobalShortcuts session.
    pub fn close_shortcuts_session(&self) {
        let session = self
            .state
            .recorded()
            .shortcuts_session
            .clone()
            .expect("a bound session");
        self.runtime
            .block_on(self.connection.emit_signal(
                None::<&str>,
                session.as_str(),
                "org.freedesktop.portal.Session",
                "Closed",
                &HashMap::<&str, OwnedValue>::new(),
            ))
            .expect("emit Closed");
    }
}
