//! Live input checks against the real Windows desktop. `#[ignore]`d: they
//! need an interactive session (the `windows-latest` runner has one). Run
//! with `--ignored --nocapture`; each prints machine-read `key=value` facts
//! for the QA evidence.

use std::time::{Duration, Instant};

use parking_lot::Mutex;
use senpi_desktop_core::ax::{snapshot, AxRegistry};
use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::types::{AxSnapshotOptions, DisplaySelector, Target};
use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

use crate::ax::live_tests::Notepad;
use crate::ax::Win32Ax;
use crate::Win32Backend;

/// Serializes the live tests that inject real input, so one test's keys
/// never land in another's window.
pub(crate) static LIVE_INPUT: Mutex<()> = Mutex::new(());

/// Hang guard only; Notepad normally renders typed text within a frame.
const HANG_GUARD: Duration = Duration::from_secs(30);

/// The foreground window as an independent `GetForegroundWindow` read.
fn foreground() -> usize {
    // SAFETY: [FFI] no arguments; reads the global foreground state.
    unsafe { GetForegroundWindow() }.addr()
}

#[test]
#[ignore = "live: needs an interactive Windows desktop and notepad.exe"]
fn foreground_type_into_notepad_restores_previous_front() {
    let _input = LIVE_INPUT.lock();
    // Given: two Notepads, the second one in front
    let mut target = Notepad::open("fg-target");
    let target_window = target.wait_for_window();
    let mut front = Notepad::open("fg-front");
    let front_window = front.wait_for_window();
    let mut backend = Win32Backend::new(DisplaySelector::All).unwrap();
    Backend::raise_window(&mut backend, &front_window.id).unwrap();
    let before = foreground();
    let marker = format!("senpi{}", std::process::id());

    // When: text is typed into the first one with foreground delivery
    let typed = Backend::type_text(
        &mut backend,
        &Target::Window(target_window.id.clone()),
        &marker,
        DeliveryMode::Foreground,
    );
    let after = foreground();

    // Then: the front window is back and the target's text changed (UIA)
    let mut ax = Win32Ax::new();
    let mut registry = AxRegistry::default();
    let started = Instant::now();
    let text = loop {
        let text = snapshot(
            &mut ax,
            &mut registry,
            &target_window,
            &AxSnapshotOptions::default(),
        )
        .unwrap()
        .text;
        if text.contains(&marker) || started.elapsed() >= HANG_GUARD {
            break text;
        }
        std::thread::yield_now();
    };
    let value_line = text.lines().find(|line| line.contains(&marker));
    println!(
        "typed={typed:?} target={} front={} foreground_before={before} foreground_after={after} \
         value_line={value_line:?}",
        target_window.id, front_window.id
    );
    assert_eq!(typed, Ok(()));
    assert_eq!(before.to_string(), front_window.id);
    assert_eq!(before, after);
    assert!(
        value_line.is_some(),
        "typed text never reached the target:\n{text}"
    );
}
