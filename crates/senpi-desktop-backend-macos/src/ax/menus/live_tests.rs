//! Live check against a real `NSMenu` menu bar. `#[ignore]`d: it needs a
//! logged-in macOS session, an Accessibility grant for the launching process,
//! and `swiftc`. Run with `--ignored --nocapture`; it prints machine-read
//! `key=value` facts for the QA evidence.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::{Backend, DeliveryMode};
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
    let second = extra.map(|_| format!("{title}-second"));
    let started = Instant::now();
    loop {
        let windows = capture().windows().unwrap();
        let second_listed = second
            .as_ref()
            .is_none_or(|second| windows.iter().any(|w| &w.title == second));
        if let Some(window) = windows.into_iter().find(|w| w.title == title).filter(|_| second_listed) {
            println!(
                "window_id={} window_title={:?} second_listed={second_listed}",
                window.id, window.title
            );
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

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant and swiftc"]
fn foreground_delivery_selects_in_the_target_window_of_a_two_window_app() {
    report_origin();
    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("record.txt");
    let title = format!("senpi-menu-fg-{}", std::process::id());
    let (_fixture, window) = launch(&build_fixture(dir.path()), &title, &record, Some("two"));
    let fixture_pid = libc::pid_t::try_from(window.pid.unwrap()).unwrap();
    // The fixture may take the front at launch; hand it back to the launching
    // app so "the front was restored" cannot pass vacuously.
    if crate::front_app::current_front_pid() == Some(fixture_pid) {
        if let Some(launcher) = responsible::current().map(|process| process.pid) {
            let _ = crate::skylight::activate_application(launcher);
            std::thread::sleep(Duration::from_millis(500));
        }
    }
    let front_before = crate::front_app::current_front_pid();
    println!("front_before={front_before:?} fixture_pid={fixture_pid}");
    assert_ne!(front_before, Some(fixture_pid), "precondition: the fixture must not already be front");

    // Through the production backend entry point, so the delivery branch in
    // backend.rs is exercised; the session admits this only under the grant.
    let mut backend = crate::MacosBackend::new(DisplaySelector::All).unwrap();
    let path = vec!["File".to_owned(), "Save".to_owned()];
    let chosen = backend
        .menu_select(&window, &path, DeliveryMode::Foreground, &|| Ok(()))
        .map_err(|e| (e.code, e.message));
    println!("fg_select={chosen:?}");
    assert_eq!(chosen, Ok(()));
    let recorded = wait_for_record(&record);
    println!("fg_recorded={recorded:?}");
    assert_eq!(recorded, format!("Save@{title}\n"), "the command ran against another window");
    let front_after = crate::front_app::current_front_pid();
    println!("front_after={front_after:?}");
    assert_eq!(front_after, front_before, "the user's front app was not handed back");

    // Background on the same two-window app keeps its refusal and dispatches nothing more.
    let background = backend
        .menu_select(&window, &path, DeliveryMode::Background, &|| Ok(()))
        .map_err(|e| e.code);
    println!("bg_two_window={background:?}");
    assert_eq!(background, Err(ErrorCode::BackgroundUnavailable));
    let after = std::fs::read_to_string(&record).unwrap_or_default();
    println!("recorded_after_background={after:?}");
    assert_eq!(after, format!("Save@{title}\n"));
}
