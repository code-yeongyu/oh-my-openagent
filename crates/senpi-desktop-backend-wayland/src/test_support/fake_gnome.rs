//! A fake GNOME Shell on its own private `dbus-daemon`: a connection owning
//! `org.gnome.Shell` that serves the window-rect extension's interface at
//! its path with a scripted `List` reply (or no extension object at all).

use std::future::Future;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::runtime::Runtime;
use zbus::interface;

use crate::compositor::gnome::{RECTS_PATH, SHELL_SERVICE};

struct WindowRects {
    reply: &'static str,
    calls: Arc<AtomicUsize>,
}

#[interface(name = "dev.omo.SenpiDesktop.WindowRects")]
impl WindowRects {
    #[zbus(name = "List")]
    fn list(&self) -> String {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.reply.to_owned()
    }
}

pub struct FakeGnome {
    daemon: Child,
    address: String,
    _shell: Option<zbus::Connection>,
    _runtime: Runtime,
    calls: Arc<AtomicUsize>,
}

enum Shell {
    Absent,
    WithoutExtension,
    Serving(&'static str),
}

impl FakeGnome {
    /// A bus where no `org.gnome.Shell` runs.
    pub fn bus_only() -> Self {
        Self::start(Shell::Absent)
    }

    /// GNOME Shell without the extension enabled.
    pub fn shell_without_extension() -> Self {
        Self::start(Shell::WithoutExtension)
    }

    /// GNOME Shell whose extension answers `List` with `reply`.
    pub fn serve(reply: &'static str) -> Self {
        Self::start(Shell::Serving(reply))
    }

    fn start(shell: Shell) -> Self {
        let dir = tempfile::Builder::new()
            .prefix("senpi-gnome-bus-")
            .tempdir()
            .expect("bus dir");
        let config = dir.path().join("bus.conf");
        std::fs::write(
            &config,
            bus_config(&dir.path().join("bus").display().to_string()),
        )
        .expect("bus config");
        // `$!` is the daemon itself; closing our stdin stops it and removes its dir.
        let script = "dbus-daemon --config-file=\"$1\" --nofork --print-address=1 & pid=$!; \
                      exec 1>&-; read _; kill $pid; rm -rf \"$2\"";
        let mut daemon = Command::new("sh")
            .args(["-c", script, "sh"])
            .arg(&config)
            .arg(dir.keep())
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
        let calls = Arc::new(AtomicUsize::new(0));
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("fake gnome runtime");
        let shell = match shell {
            Shell::Absent => None,
            Shell::WithoutExtension => Some(runtime.block_on(async {
                zbus::connection::Builder::address(address.as_str())?
                    .name(SHELL_SERVICE)?
                    .build()
                    .await
            })),
            Shell::Serving(reply) => {
                let rects = WindowRects {
                    reply,
                    calls: Arc::clone(&calls),
                };
                Some(runtime.block_on(async {
                    zbus::connection::Builder::address(address.as_str())?
                        .name(SHELL_SERVICE)?
                        .serve_at(RECTS_PATH, rects)?
                        .build()
                        .await
                }))
            }
        }
        .map(|connection| connection.expect("fake gnome shell connection"));
        Self {
            daemon,
            address,
            _shell: shell,
            _runtime: runtime,
            calls,
        }
    }

    pub fn connect(&self) -> impl Future<Output = zbus::Result<zbus::Connection>> {
        let address = self.address.clone();
        async move {
            zbus::connection::Builder::address(address.as_str())?
                .build()
                .await
        }
    }

    pub fn list_calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Drop for FakeGnome {
    fn drop(&mut self) {
        drop(self.daemon.stdin.take());
        let _ = self.daemon.wait();
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
