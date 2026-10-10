//! Live check against a real `NSMenu` menu bar. `#[ignore]`d: it needs a
//! logged-in macOS session, an Accessibility grant for the launching process,
//! and `swiftc`. Run with `--ignored --nocapture`; it prints machine-read
//! `key=value` facts for the QA evidence.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use super::{items, select};
use crate::ax::is_trusted;
use crate::responsible;

const FIXTURE_SOURCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/menu_fixture.swift");
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);
const RECORD_DEADLINE: Duration = Duration::from_secs(5);

struct Fixture(Child);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn build_fixture(dir: &Path) -> PathBuf {
    let binary = dir.join("menu-fixture");
    let status = Command::new("/usr/bin/swiftc")
        .arg(FIXTURE_SOURCE)
        .arg("-o")
        .arg(&binary)
        .status()
        .unwrap();
    assert!(status.success(), "swiftc failed to build the menu fixture");
    binary
}

/// Polls for the fixture's window in the live `windows()` list by title.
fn find_window(title: &str) -> Option<senpi_desktop_core::types::DesktopWindow> {
    let capture = crate::capture::MacCapture::new(
        senpi_desktop_core::types::DisplaySelector::All,
        crate::capture::Screencapture::system(),
    );
    capture.windows().ok()?.into_iter().find(|window| window.title == title)
}

/// AXPress posts the menu action; the fixture runs it on its own run loop
/// afterwards, so wait (bounded) for the record it writes.
fn wait_for_record(path: &Path) -> String {
    let started = Instant::now();
    loop {
        let recorded = std::fs::read_to_string(path).unwrap_or_default();
        if !recorded.is_empty() || started.elapsed() >= RECORD_DEADLINE {
            return recorded;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant and swiftc"]
fn menu_listing_and_select_against_a_real_nsmenu() {
    match responsible::current() {
        Some(process) => println!(
            "responsible_pid={} responsible_executable={} responsible_bundle={:?}",
            process.pid,
            process.executable.display(),
            process.bundle_id
        ),
        None => println!("responsible=unknown"),
    }
    println!("ax_trusted={}", is_trusted());
    assert!(is_trusted(), "the launching process has no Accessibility grant");

    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("record.txt");
    let title = format!("senpi-menu-live-{}", std::process::id());
    let child = Command::new(build_fixture(dir.path()))
        .arg(&title)
        .arg(&record)
        .spawn()
        .unwrap();
    let fixture = Fixture(child);
    println!("fixture_pid={} record={}", fixture.0.id(), record.display());

    let started = Instant::now();
    let window = loop {
        if let Some(window) = find_window(&title) {
            break window;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "the fixture's window never appeared"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    println!("window_id={} window_title={:?}", window.id, window.title);

    let file_path = vec!["File".to_string()];
    let listed = items(&window, &file_path).map_err(|error| error.message);
    println!("list_file_ok={}", listed.is_ok());
    let items = listed.unwrap();
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    println!("file_items={titles:?}");
    let save = items.iter().find(|item| item.title == "Save");
    println!("save_shortcut={:?}", save.map(|item| item.shortcut.clone()));
    assert!(save.is_some_and(|item| item.shortcut.as_deref() == Some("Cmd+S")));
    let revert = items.iter().find(|item| item.title == "Revert");
    println!("revert_enabled={:?}", revert.map(|item| item.enabled));
    assert_eq!(revert.map(|item| item.enabled), Some(false));

    let chosen = select(&window, &["File".into(), "Save".into()], &|| Ok(())).map_err(|e| e.message);
    println!("select_save_ok={}", chosen.is_ok());
    assert_eq!(chosen, Ok(()));
    let recorded = wait_for_record(&record);
    println!("recorded={recorded:?}");
    assert!(recorded.contains("Save"), "the fixture recorded {recorded:?}");

    let disabled = select(&window, &["File".into(), "Revert".into()], &|| Ok(())).map_err(|e| e.message);
    println!("select_revert_err={:?}", disabled.as_ref().err());
    assert!(disabled.is_err());

    let submenu_leaf = select(&window, &["File".into(), "Export…".into()], &|| Ok(())).map_err(|e| e.message);
    println!("select_export_err={:?}", submenu_leaf.as_ref().err());
    assert!(submenu_leaf.is_err());
}
