//! Live menu checks against a real GTK menu bar over a real AT-SPI bus.
//! `#[ignore]`d; each needs a fresh session of its own:
//!
//! `dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" cargo test
//! -p senpi-desktop-backend-atspi --lib -- --ignored --exact --nocapture <name>`
//!
//! The fixture (`tests/fixtures/menu_fixture.py`, `python3-gi` + GTK 3)
//! prints `READY`, then `<label>@<title>` for every item it activates.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;

use crate::{AtSpiAx, WindowIds};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/menu_fixture.py");
const DEADLINE: Duration = Duration::from_secs(30);
const REGISTRY_READS: usize = 200;

struct Fixture {
    child: Child,
    lines: Receiver<String>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(err) = self.child.kill().and_then(|()| self.child.wait().map(drop)) {
            eprintln!("fixture cleanup failed: {err}");
        }
    }
}

impl Fixture {
    fn spawn(title: &str) -> Self {
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
        let fixture = Self { child, lines };
        assert_eq!(fixture.next("READY"), "READY");
        fixture
    }

    fn next(&self, what: &str) -> String {
        self.lines
            .recv_timeout(DEADLINE)
            .unwrap_or_else(|err| panic!("{what} never arrived: {err}"))
    }
}

fn find_window(ax: &mut AtSpiAx, title: &str) -> DesktopWindow {
    (0..REGISTRY_READS)
        .find_map(|_| ax.windows().ok()?.into_iter().find(|window| window.title == title))
        .unwrap_or_else(|| panic!("the fixture window never reached the registry"))
}

fn labels(path: &[&str]) -> Vec<String> {
    path.iter().map(|label| (*label).to_string()).collect()
}

fn no_stop() -> CoreResult<()> {
    Ok(())
}

#[test]
#[ignore = "live: needs an AT-SPI bus (dbus-run-session), an X display, and python3-gi with GTK 3"]
fn menu_listing_and_select_against_a_real_gtk_menu_bar() {
    let title = format!("senpi-atspi-menu-{}", std::process::id());
    let fixture = Fixture::spawn(&title);
    let mut ax = AtSpiAx::new(WindowIds::AtSpiFrames).unwrap();
    let window = find_window(&mut ax, &title);
    println!("window_id={} pid={:?}", window.id, window.pid);

    let bar = ax.menu_items(&window, &[], &[]).unwrap();
    let bar_titles: Vec<&str> = bar.iter().map(|item| item.title.as_str()).collect();
    println!("menu_bar={bar_titles:?}");
    assert_eq!(bar_titles, ["File", "Edit"]);

    let file = ax.menu_items(&window, &[], &labels(&["File"])).unwrap();
    let file_titles: Vec<&str> = file.iter().map(|item| item.title.as_str()).collect();
    println!("file_menu={file_titles:?} save_shortcut={:?}", file[1].shortcut);
    assert_eq!(file_titles, ["Open...", "Save", "Print", "print", "Recent"]);
    assert_eq!(file[1].shortcut.as_deref(), Some("<Primary>s"));
    assert!(file[4].has_submenu);

    for (path, expected) in [
        (&["file", "save"][..], "Save"),
        (&["File", "Open"][..], "Open..."),
        (&["File", "Recent", "a.txt"][..], "a.txt"),
    ] {
        ax.menu_select(&window, &[], &|| Ok(Vec::new()), &labels(path), &no_stop).unwrap();
        assert_eq!(fixture.next(expected), format!("{expected}@{title}"));
    }

    let ambiguous = ax.menu_select(&window, &[], &|| Ok(Vec::new()), &labels(&["File", "Print"]), &no_stop).unwrap_err();
    let disabled = ax.menu_select(&window, &[], &|| Ok(Vec::new()), &labels(&["Edit", "Undo"]), &no_stop).unwrap_err();
    let submenu = ax.menu_select(&window, &[], &|| Ok(Vec::new()), &labels(&["File", "Recent"]), &no_stop).unwrap_err();
    println!(
        "ambiguous_error={} disabled_error={} submenu_error={}",
        ambiguous.message, disabled.message, submenu.message
    );
    assert!(ambiguous.message.contains("ambiguous"), "{}", ambiguous.message);
    assert!(disabled.message.contains("disabled"), "{}", disabled.message);
    assert!(submenu.message.contains("leaf menu command"), "{}", submenu.message);
    // The app reports activations in order, so the sentinel arriving next
    // proves none of the refused paths (sensitive ambiguous items and a
    // submenu that reports its own activation) dispatched anything.
    ax.menu_select(&window, &[], &|| Ok(Vec::new()), &labels(&["File", "Save"]), &no_stop).unwrap();
    assert_eq!(fixture.next("the sentinel Save"), format!("Save@{title}"), "a refused path ran a command");
}
