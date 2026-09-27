//! Live checks against a real AT-SPI bus. `#[ignore]`d; each needs a fresh
//! session of its own, so run them one per invocation:
//!
//! `dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" cargo test
//! -p senpi-desktop-backend-atspi -- --ignored --nocapture <name>`
//!
//! and `no_bus_reports_bus_unreachable` with the session bus pointed at a
//! socket that does not exist. The GTK terminal stands in for xterm, which
//! (Xaw) never publishes an AT-SPI tree. Each test prints machine-read
//! `key=value` facts for the QA evidence.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{snapshot, AxRegistry};
use senpi_desktop_core::types::{AxSnapshotOptions, DesktopWindow};

use crate::{AtSpiAx, AxPermission, LiveBus};

const TERMINAL: &str = "xfce4-terminal";
/// Hang guard for the terminal's launch; it registers in well under 5 s.
const DEADLINE: Duration = Duration::from_secs(30);

/// Kills the terminal on every exit path, including a failed assertion.
struct Terminal(Child);

impl Drop for Terminal {
    fn drop(&mut self) {
        if let Err(err) = self.0.kill().and_then(|()| self.0.wait().map(drop)) {
            eprintln!("terminal cleanup failed: {err}");
        }
    }
}

/// A terminal titled `title` that runs `sleep`, so no shell retitles it.
fn spawn_terminal(title: &str, env: &[(&str, &str)]) -> Terminal {
    let child = Command::new(TERMINAL)
        .args([
            "--disable-server",
            &format!("--title={title}"),
            "-x",
            "sleep",
            "300",
        ])
        .envs(env.iter().copied())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    Terminal(child)
}

fn until<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    loop {
        if let Some(found) = probe() {
            return found;
        }
        assert!(started.elapsed() < DEADLINE, "{what} never happened");
        std::thread::yield_now();
    }
}

fn find_window(ax: &mut AtSpiAx, title: &str) -> Option<DesktopWindow> {
    ax.windows()
        .ok()?
        .into_iter()
        .find(|window| window.title == title)
}

#[test]
#[ignore = "live: needs an AT-SPI bus (dbus-run-session), an X display, and xfce4-terminal"]
fn ax_tree_of_xterm_lists_window() {
    let title = format!("senpi-atspi-live-{}", std::process::id());
    let terminal = spawn_terminal(&title, &[]);
    let mut ax = AtSpiAx::new().unwrap();
    let window = until("the terminal window", || find_window(&mut ax, &title));
    println!("window_id={} app={} pid={:?}", window.id, window.app, window.pid);
    assert_eq!(window.pid, Some(terminal.0.id()));
    let mut registry = AxRegistry::default();
    let unfiltered = AxSnapshotOptions {
        all: Some(true),
        ..AxSnapshotOptions::default()
    };
    let tree = snapshot(&mut ax, &mut registry, &window, &unfiltered).unwrap();
    println!("node_count={} truncated={}", tree.node_count, tree.truncated);
    println!("{}", tree.text);
    let first = tree.text.lines().next().unwrap();
    assert!(
        first.starts_with(&format!("- window \"{title}\" [ref=e1]")),
        "{first}"
    );
    assert!(tree.node_count > 1, "the walk never left the frame");
    println!("ax_permission={}", ax.permission().as_str());
}

#[test]
#[ignore = "live: needs a fresh AT-SPI bus with no application registered"]
fn permission_is_toolkits_silent_until_a_toolkit_publishes() {
    let mut ax = AtSpiAx::new().unwrap();
    let before = ax.permission();
    println!(
        "ax_permission_before={} ax={}",
        before.as_str(),
        before.is_granted()
    );
    assert_eq!(before, AxPermission::ToolkitsSilent);
    let title = format!("senpi-atspi-silent-{}", std::process::id());
    let _terminal = spawn_terminal(&title, &[("GTK_MODULES", "gail:atk-bridge")]);
    let after = until("granted", || {
        Some(ax.permission()).filter(|permission| permission.is_granted())
    });
    println!("ax_permission_after={} ax={}", after.as_str(), after.is_granted());
}

#[test]
#[ignore = "live: needs DBUS_SESSION_BUS_ADDRESS pointing at no bus and AT_SPI_BUS_ADDRESS unset"]
fn no_bus_reports_bus_unreachable() {
    assert!(std::env::var_os("AT_SPI_BUS_ADDRESS").is_none());
    let error = AtSpiAx::new().err().unwrap();
    println!("connect_error={error}");
    let mut ax: Option<AtSpiAx<LiveBus>> = None;
    let permission = AxPermission::of(ax.as_mut());
    println!(
        "ax_permission={} ax={}",
        permission.as_str(),
        permission.is_granted()
    );
    assert_eq!(permission, AxPermission::BusUnreachable);
}
