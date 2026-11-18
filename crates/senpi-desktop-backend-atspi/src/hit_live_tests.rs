//! Live hit-test check against a real GTK window over a real AT-SPI bus.
//! `#[ignore]`d; it needs a fresh session of its own:
//!
//! `dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" cargo test
//! -p senpi-desktop-backend-atspi --lib -- --ignored --exact --nocapture <name>`
//!
//! The fixture (`tests/fixtures/hit_fixture.py`, `python3-gi` + GTK 3)
//! nests a Press button and a Value field under the frame's root filler.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::channel;
use std::time::Duration;

use atspi::ObjectRefOwned;
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::types::DesktopWindow;

use crate::apps::window_root;
use crate::bus::AtSpiBus;
use crate::{AtSpiAx, WindowIds};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/hit_fixture.py");
const DEADLINE: Duration = Duration::from_secs(30);
const REGISTRY_READS: usize = 200;
const MAX_WALK: usize = 400;

struct Fixture(Child);

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(err) = self.0.kill().and_then(|()| self.0.wait().map(drop)) {
            eprintln!("fixture cleanup failed: {err}");
        }
    }
}

fn spawn(title: &str) -> Fixture {
    let mut child = Command::new("python3")
        .args([FIXTURE, title])
        .env("GTK_MODULES", "gail:atk-bridge")
        .env("NO_AT_BRIDGE", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (send, lines) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if send.send(line).is_err() {
                break;
            }
        }
    });
    let fixture = Fixture(child);
    assert_eq!(lines.recv_timeout(DEADLINE).unwrap(), "READY");
    fixture
}

fn find_window(ax: &mut AtSpiAx, title: &str) -> DesktopWindow {
    (0..REGISTRY_READS)
        .find_map(|_| ax.windows().ok()?.into_iter().find(|window| window.title == title))
        .unwrap_or_else(|| panic!("the fixture window never reached the registry"))
}

/// The first element under `root`, breadth first, with this name.
fn find(ax: &mut AtSpiAx, root: ObjectRefOwned, name: &str) -> ObjectRefOwned {
    let mut queue = vec![root];
    for _ in 0..MAX_WALK {
        let Some(node) = (!queue.is_empty()).then(|| queue.remove(0)) else {
            break;
        };
        if ax.bus.name(&node).is_ok_and(|found| found == name) {
            return node;
        }
        queue.extend(ax.bus.children(&node).unwrap_or_default());
    }
    panic!("nothing named {name:?} in the fixture window");
}

#[test]
#[ignore = "live: needs an AT-SPI bus (dbus-run-session), an X display, and python3-gi with GTK 3"]
fn element_at_names_the_deepest_element_of_a_real_gtk_window() {
    let title = format!("senpi-atspi-hit-{}", std::process::id());
    let _fixture = spawn(&title);
    let mut ax = AtSpiAx::new(WindowIds::Native).unwrap();
    let window = find_window(&mut ax, &title);
    for name in ["Press", "Value"] {
        let root = window_root(&mut ax.bus, &window).unwrap();
        let target = find(&mut ax, root, name);
        let want = (ax.bus.role(&target).unwrap(), name.to_string());
        let box_ = ax.bus.extents(&target).unwrap();
        let (x, y) = (box_.x + box_.width / 2, box_.y + box_.height / 2);
        let hit = ax.element_at(f64::from(x), f64::from(y)).unwrap().unwrap();
        let hit = hit.downcast_native::<ObjectRefOwned>().unwrap().clone();
        let got = (ax.bus.role(&hit).unwrap(), ax.bus.name(&hit).unwrap());
        println!("target={:?}:{name} point={x},{y} hit_test={:?}:{} matches={}", want.0, got.0, got.1, got == want);
        assert_eq!(got, want);
    }
}
