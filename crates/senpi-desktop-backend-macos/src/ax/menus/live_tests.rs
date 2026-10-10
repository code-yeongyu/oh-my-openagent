//! Live check against a real `NSMenu` menu bar. `#[ignore]`d: it needs a
//! logged-in macOS session, an Accessibility grant for the launching process,
//! and `swiftc`. Run with `--ignored --nocapture`; it prints machine-read
//! `key=value` facts for the QA evidence.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::types::{DesktopWindow, DisplaySelector};

use super::{items, select};
use crate::ax::is_trusted;
use crate::capture::{MacCapture, Screencapture};
use crate::input::{CanaryMode, MacInput};
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

fn capture() -> MacCapture {
    MacCapture::new(DisplaySelector::All, Screencapture::system())
}

fn launch(binary: &Path, title: &str, record: &Path, extra: Option<&str>) -> (Fixture, DesktopWindow) {
    let mut command = Command::new(binary);
    command.arg(title).arg(record);
    if let Some(extra) = extra {
        command.arg(extra);
    }
    let fixture = Fixture(command.spawn().unwrap());
    println!("fixture_pid={} title={title}", fixture.0.id());
    let started = Instant::now();
    loop {
        if let Some(window) = capture().windows().unwrap().into_iter().find(|w| w.title == title) {
            println!("window_id={} window_title={:?}", window.id, window.title);
            return (fixture, window);
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "the fixture's window never appeared"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
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

/// Selects through the production make-key step: the same `MacInput` path the
/// backend uses, so the activation record is the real one.
fn select_via(input: &mut MacInput, window: &DesktopWindow, path: &[&str]) -> CoreResult<()> {
    let path: Vec<String> = path.iter().map(|label| (*label).to_owned()).collect();
    let capture = capture();
    select(window, &path, &|| Ok(()), &mut || {
        input.make_menu_window_key(window, &capture)
    })
}

fn report_origin() {
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
}

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant and swiftc"]
fn menu_listing_and_select_against_a_real_nsmenu() {
    report_origin();
    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("record.txt");
    let title = format!("senpi-menu-live-{}", std::process::id());
    let (_fixture, window) = launch(&build_fixture(dir.path()), &title, &record, None);
    let mut input = MacInput::new(CanaryMode::Off).unwrap();

    let listed = items(&window, &["File".to_string()]).map_err(|error| error.message);
    println!("list_file_ok={}", listed.is_ok());
    let items = listed.unwrap();
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    println!("file_items={titles:?}");
    let save = items.iter().find(|item| item.title == "Save");
    println!("save_shortcut={:?}", save.and_then(|item| item.shortcut.clone()));
    assert!(save.is_some_and(|item| item.shortcut.as_deref() == Some("Cmd+S")));
    let revert = items.iter().find(|item| item.title == "Revert");
    println!("revert_enabled={:?}", revert.map(|item| item.enabled));
    assert_eq!(revert.map(|item| item.enabled), Some(false));

    let chosen = select_via(&mut input, &window, &["File", "Save"]).map_err(|e| e.message);
    println!("select_save_ok={}", chosen.is_ok());
    assert_eq!(chosen, Ok(()));
    let recorded = wait_for_record(&record);
    println!("recorded={recorded:?}");
    assert_eq!(recorded, "Save\n");
    let activated = input.take_last_activated();
    println!("last_activated={activated:?}");
    let pid = libc::pid_t::try_from(window.pid.unwrap()).unwrap();
    assert_eq!(activated, Some((pid, window.id.parse::<u32>().unwrap())));

    let disabled = select_via(&mut input, &window, &["File", "Revert"]).map_err(|e| (e.code, e.message));
    println!("select_revert_err={:?}", disabled.as_ref().err());
    assert_eq!(disabled.map_err(|(code, _)| code), Err(ErrorCode::AxFailed));
    let submenu_leaf = select_via(&mut input, &window, &["File", "Export…"]).map_err(|e| (e.code, e.message));
    println!("select_export_err={:?}", submenu_leaf.as_ref().err());
    assert_eq!(submenu_leaf.map_err(|(code, _)| code), Err(ErrorCode::AxFailed));
    let after_refusals = std::fs::read_to_string(&record).unwrap_or_default();
    println!("recorded_after_refusals={after_refusals:?}");
    assert_eq!(after_refusals, "Save\n", "a refused selection dispatched a command");
}

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant and swiftc"]
fn an_app_with_two_windows_is_refused_before_any_activation() {
    report_origin();
    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("record.txt");
    let title = format!("senpi-menu-two-{}", std::process::id());
    let (_fixture, window) = launch(&build_fixture(dir.path()), &title, &record, Some("two"));
    let mut input = MacInput::new(CanaryMode::Off).unwrap();

    let refused = select_via(&mut input, &window, &["File", "Save"]).map_err(|e| (e.code, e.message));
    println!("two_window_select_err={:?}", refused.as_ref().err());
    assert_eq!(refused.map_err(|(code, _)| code), Err(ErrorCode::BackgroundUnavailable));
    let recorded = wait_for_record(&record);
    println!("two_window_recorded={recorded:?}");
    assert_eq!(recorded, "", "a refused selection dispatched a command");
    let activated = input.take_last_activated();
    println!("two_window_last_activated={activated:?}");
    assert_eq!(activated, None);
}
