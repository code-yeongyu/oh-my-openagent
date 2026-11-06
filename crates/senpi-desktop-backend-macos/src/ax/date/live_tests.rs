//! Live check against a real `NSDatePicker`. `#[ignore]`d: it needs a
//! logged-in macOS session, an Accessibility grant for the launching process,
//! `swiftc`, and `TZ=Europe/Berlin` so the daylight-saving refusals are the
//! same on every host. Run with `--ignored --nocapture`; it prints
//! machine-read `key=value` facts for the QA evidence.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use objc2_application_services::AXUIElement;
use objc2_core_foundation::{CFRetained, CFTimeZone};

use super::super::{actions, element, is_trusted};
use super::format_local;
use crate::front_app::current_front_pid;
use crate::responsible;

const FIXTURE_SOURCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/date_fixture.swift");
/// Hang guard for the fixture's launch; its window usually appears in < 1 s.
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);

struct Fixture(Child);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn build_fixture(dir: &Path) -> PathBuf {
    let binary = dir.join("date-fixture");
    let status = Command::new("/usr/bin/swiftc")
        .arg(FIXTURE_SOURCE)
        .arg("-o")
        .arg(&binary)
        .status()
        .unwrap();
    assert!(status.success(), "swiftc failed to build the date fixture");
    binary
}

fn find_date_control(pid: u32, title: &str) -> Option<CFRetained<AXUIElement>> {
    let app = element::create_application(libc::pid_t::try_from(pid).ok()?).ok()?;
    let window = element::copy_elements(&app, "AXWindows")?
        .into_iter()
        .find(|window| element::copy_string(window, "AXTitle").as_deref() == Some(title))?;
    let mut queue = vec![window];
    while let Some(node) = queue.pop() {
        if element::copy_date(&node, "AXValue").is_some() {
            return Some(node);
        }
        queue.extend(element::copy_elements(&node, "AXChildren").unwrap_or_default());
    }
    None
}

fn reads(control: &AXUIElement) -> Option<String> {
    let zone = CFTimeZone::system()?;
    let at = element::copy_date(control, "AXValue")?;
    Some(format_local(at, |at| zone.seconds_from_gmt(at) as i64))
}

fn step(name: &str, control: &AXUIElement, value: &str) -> Result<(), String> {
    let result = actions::set_value(control, value).map_err(|error| error.message);
    println!(
        "step={name} value={value:?} ok={} reads={:?} front_pid={:?} error={:?}",
        result.is_ok(),
        reads(control),
        current_front_pid(),
        result.as_ref().err(),
    );
    result
}

#[test]
#[ignore = "needs a logged-in macOS session, an Accessibility grant, swiftc and TZ=Europe/Berlin"]
fn set_value_on_a_native_date_picker_writes_dates_and_refuses_dst_gaps_and_folds() {
    match responsible::current() {
        Some(process) => println!(
            "responsible_pid={} responsible_executable={} responsible_bundle={:?}",
            process.pid,
            process.executable.display(),
            process.bundle_id
        ),
        None => println!("responsible=unknown"),
    }
    println!("ax_trusted={} tz={:?}", is_trusted(), std::env::var("TZ").ok());
    assert!(is_trusted(), "the launching process has no Accessibility grant");
    assert_eq!(std::env::var("TZ").as_deref(), Ok("Europe/Berlin"));
    let dir = tempfile::tempdir().unwrap();
    let title = format!("senpi-date-live-{}", std::process::id());
    let fixture = Fixture(Command::new(build_fixture(dir.path())).arg(&title).spawn().unwrap());
    let started = Instant::now();
    let control = loop {
        if let Some(control) = find_date_control(fixture.0.id(), &title) {
            break control;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "the fixture's date control never appeared"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    println!("fixture_pid={} initial={:?}", fixture.0.id(), reads(&control));

    assert_eq!(step("local", &control, "2026-11-05T09:30"), Ok(()));
    assert_eq!(reads(&control).as_deref(), Some("2026-11-05T09:30:00+01:00"));

    let skipped = step("skipped", &control, "2026-03-29T02:30").unwrap_err();
    assert!(skipped.contains("does not exist"), "{skipped}");
    let repeated = step("repeated", &control, "2026-10-25T02:30").unwrap_err();
    assert!(repeated.contains("occurs twice"), "{repeated}");
    let malformed = step("malformed", &control, "11/05/2026").unwrap_err();
    assert!(malformed.contains("not ISO-8601"), "{malformed}");
    assert_eq!(reads(&control).as_deref(), Some("2026-11-05T09:30:00+01:00"));

    assert_eq!(step("offset", &control, "2026-10-25T02:30+01:00"), Ok(()));
    assert_eq!(reads(&control).as_deref(), Some("2026-10-25T02:30:00+01:00"));
}
