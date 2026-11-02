//! Live check against a real `NSPopUpButton`. `#[ignore]`d: it needs a
//! logged-in macOS session, an Accessibility grant for the launching process,
//! and `swiftc`. Run with `--ignored --nocapture`; it prints machine-read
//! `key=value` facts for the QA evidence.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use objc2_application_services::AXUIElement;
use objc2_core_foundation::CFRetained;

use super::super::{actions, element, is_trusted};
use crate::front_app::current_front_pid;
use crate::responsible;

const FIXTURE_SOURCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/popup_fixture.swift");
/// Hang guard for the fixture's launch; its window usually appears in < 1 s.
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);
const MENU_GONE_DEADLINE: Duration = Duration::from_secs(2);

struct Fixture(Child);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn build_fixture(dir: &Path) -> PathBuf {
    let binary = dir.join("popup-fixture");
    let status = Command::new("/usr/bin/swiftc")
        .arg(FIXTURE_SOURCE)
        .arg("-o")
        .arg(&binary)
        .status()
        .unwrap();
    assert!(status.success(), "swiftc failed to build the popup fixture");
    binary
}

fn find_popup(pid: u32, title: &str) -> Option<CFRetained<AXUIElement>> {
    let app = element::create_application(libc::pid_t::try_from(pid).ok()?).ok()?;
    let window = element::copy_elements(&app, "AXWindows")?
        .into_iter()
        .find(|window| element::copy_string(window, "AXTitle").as_deref() == Some(title))?;
    let mut queue = vec![window];
    while let Some(node) = queue.pop() {
        if element::copy_string(&node, "AXRole").as_deref() == Some("AXPopUpButton") {
            return Some(node);
        }
        queue.extend(element::copy_elements(&node, "AXChildren").unwrap_or_default());
    }
    None
}

fn menu_open(popup: &AXUIElement) -> bool {
    element::copy_elements(popup, "AXChildren")
        .unwrap_or_default()
        .iter()
        .any(|child| element::copy_string(child, "AXRole").as_deref() == Some("AXMenu"))
}

/// How long after a call the popup's `AXMenu` element takes to go away, if
/// it does within `MENU_GONE_DEADLINE`.
fn menu_gone_after(popup: &AXUIElement) -> Option<Duration> {
    let started = Instant::now();
    while started.elapsed() < MENU_GONE_DEADLINE {
        if !menu_open(popup) {
            return Some(started.elapsed());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

fn report(step: &str, popup: &AXUIElement, result: &Result<(), String>) -> bool {
    let menu_open_at_return = menu_open(popup);
    let gone = menu_gone_after(popup);
    println!(
        "step={step} ok={} value={:?} menu_open_at_return={menu_open_at_return} menu_gone_after_ms={:?} front_pid={:?} error={:?}",
        result.is_ok(),
        element::copy_string(popup, "AXValue"),
        gone.map(|elapsed| elapsed.as_millis()),
        current_front_pid(),
        result.as_ref().err(),
    );
    menu_open_at_return
}

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant and swiftc"]
fn set_value_on_a_native_popup_chooses_refuses_and_leaves_no_menu_open() {
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
    let title = format!("senpi-popup-live-{}", std::process::id());
    let child = Command::new(build_fixture(dir.path())).arg(&title).spawn().unwrap();
    let fixture = Fixture(child);
    let front_before = current_front_pid();
    let started = Instant::now();
    let popup = loop {
        if let Some(popup) = find_popup(fixture.0.id(), &title) {
            break popup;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "the fixture's popup never appeared"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    println!("fixture_pid={} front_before={front_before:?}", fixture.0.id());

    let chosen = actions::set_value(&popup, "Web Page (.html)").map_err(|error| error.message);
    let open_at_return = report("choose", &popup, &chosen);
    assert_eq!(chosen, Ok(()));
    assert_eq!(
        element::copy_string(&popup, "AXValue").as_deref(),
        Some("Web Page (.html)")
    );
    assert!(!open_at_return, "the menu stayed open after the choice");

    let missing = actions::set_value(&popup, "web page (.html)").map_err(|error| error.message);
    let open_at_return = report("missing", &popup, &missing);
    assert!(missing.is_err());
    assert_eq!(
        element::copy_string(&popup, "AXValue").as_deref(),
        Some("Web Page (.html)")
    );
    assert!(!open_at_return, "a refused choice left the menu it opened open");

    let disabled = actions::set_value(&popup, "Disabled Option").map_err(|error| error.message);
    let open_at_return = report("disabled", &popup, &disabled);
    assert!(disabled.is_err());
    assert!(!open_at_return, "a disabled option left the menu it opened open");
}
