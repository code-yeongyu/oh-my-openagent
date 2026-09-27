//! Live-test setup: TextEdit documents, a frontmost Terminal, HID keystrokes
//! posted by the test itself, and window waits.

use std::process::Command;
use std::time::{Duration, Instant};

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

use senpi_desktop_core::types::DesktopWindow;

use crate::ax;
use crate::backend::MacosBackend;

/// Hang guard for app launches; windows normally appear in < 2 s.
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);

/// The TextEdit document window titled `title`, as the backend lists it.
pub(crate) fn open_textedit_document(dir: &tempfile::TempDir, title: &str) -> DesktopWindow {
    let path = dir.path().join(title);
    std::fs::write(&path, "").unwrap();
    let status = Command::new("/usr/bin/open")
        .args(["-a", "TextEdit"])
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    let pid = wait_for_pid("com.apple.TextEdit").expect("TextEdit process");
    let started = Instant::now();
    loop {
        if let Some(window) = ax_window("TextEdit", pid, title) {
            return window;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "TextEdit window '{title}' never appeared"
        );
        std::thread::yield_now();
    }
}

/// The AX window `(pid, CGWindowID, bounds)` of `app` titled `title`, wrapped
/// as a `DesktopWindow` with real global bounds (no Screen Recording needed).
fn ax_window(app: &str, pid: i32, title: &str) -> Option<DesktopWindow> {
    let application = ax::element::create_application(pid).ok()?;
    for window in ax::element::copy_elements(&application, "AXWindows").unwrap_or_default() {
        if ax::element::copy_string(&window, "AXTitle").as_deref() != Some(title) {
            continue;
        }
        let bounds = ax::element::bounds(&window)?;
        let id = ax::element::window_id(&window)?;
        return Some(DesktopWindow {
            id: id.to_string(),
            title: title.to_string(),
            app: app.to_string(),
            pid: Some(u32::try_from(pid).ok()?),
            x: bounds.x as i32,
            y: bounds.y as i32,
            width: bounds.width as u32,
            height: bounds.height as u32,
            focused: false,
            elevated: None,
        });
    }
    None
}

/// `bundle_id`'s pid through an NSRunningApplication bundle query. `pgrep`
/// finds no Terminal from inside some launch contexts on this host,
/// NSWorkspace's application array never refreshes without a runloop, and a
/// full libproc scan proved flaky under load; the bundle query is the direct
/// AppKit answer.
pub(super) fn wait_for_pid(bundle_id: &str) -> Option<i32> {
    let started = Instant::now();
    loop {
        let pid = bundle_pid(bundle_id);
        if pid.is_some() {
            return pid;
        }
        if started.elapsed() >= WINDOW_DEADLINE {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn bundle_pid(bundle_id: &str) -> Option<i32> {
    let identifier = objc2_foundation::NSString::from_str(bundle_id);
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&identifier)
        .iter()
        .next()
        .map(|app| app.processIdentifier())
}

/// Asserts `process` currently exposes no windows (the sole-window rule).
pub(super) fn assert_no_windows(bundle_id: &str) {
    let Some(pid) = bundle_pid(bundle_id) else {
        return;
    };
    let Ok(application) = ax::element::create_application(pid) else {
        return;
    };
    let windows = ax::element::copy_elements(&application, "AXWindows").unwrap_or_default();
    assert!(
        windows.is_empty(),
        "precondition: {bundle_id} must have no open windows (found {}); close them first",
        windows.len()
    );
}

/// The AX window count of `pid`, for teardown bookkeeping.
fn ax_window_count(pid: i32) -> usize {
    ax::element::create_application(pid)
        .ok()
        .and_then(|app| ax::element::copy_elements(&app, "AXWindows"))
        .map_or(0, |windows| windows.len())
}

/// Activates Terminal and waits until it is frontmost. Returns the process id
/// and whether a new window appeared, so teardown closes only what the test
/// created.
pub(crate) fn bring_terminal_front() -> (i32, bool) {
    let pid_before = bundle_pid("com.apple.Terminal");
    let windows_before = pid_before.map_or(0, ax_window_count);
    let status = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .status()
        .unwrap();
    assert!(status.success());
    let pid = wait_for_pid("com.apple.Terminal").expect("Terminal process");
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid).unwrap();
    #[expect(deprecated, reason = "the test forces Terminal to be the frontmost app")]
    let options = NSApplicationActivationOptions::ActivateIgnoringOtherApps;
    assert!(app.activateWithOptions(options));
    let started = Instant::now();
    loop {
        if let Ok(Some(front)) = crate::focus::front_window() {
            if front.app == "Terminal" {
                break;
            }
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "Terminal never became frontmost"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    let opened_new = pid_before.is_none_or(|before| before != pid || ax_window_count(pid) > windows_before);
    (pid, opened_new)
}

/// Closes `pid`'s focused window through AX (teardown).
pub(super) fn close_focused_window(pid: i32) {
    let Ok(application) = ax::element::create_application(pid) else {
        return;
    };
    let Some(window) = ax::element::copy_element(&application, "AXFocusedWindow") else {
        return;
    };
    let Some(id) = ax::element::window_id(&window) else {
        return;
    };
    let window = DesktopWindow {
        id: id.to_string(),
        title: String::new(),
        app: "Terminal".to_string(),
        pid: u32::try_from(pid).ok(),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        focused: false,
        elevated: None,
    };
    let _ = crate::ax::close_window(&window);
}

/// One real HID keystroke from the test process (the "user" side).
pub(super) fn post_hid_character(character: char) {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    let event = CGEvent::new_keyboard_event(source.clone(), 0, true).unwrap();
    event.set_string(&character.to_string());
    event.set_flags(CGEventFlags::CGEventFlagNull);
    event.post(CGEventTapLocation::HID);
    let up = CGEvent::new_keyboard_event(source, 0, false).unwrap();
    up.set_string(&character.to_string());
    up.set_flags(CGEventFlags::CGEventFlagNull);
    up.post(CGEventTapLocation::HID);
}

/// One real HID key-code press (e.g. Backspace) from the test process.
pub(super) fn post_hid_key(code: u16) {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    for down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.clone(), code, down).unwrap();
        event.set_flags(CGEventFlags::CGEventFlagNull);
        event.post(CGEventTapLocation::HID);
    }
}

pub(super) const BACKSPACE: u16 = 51;

/// Waits until the backend lists window `id`.
pub(super) fn wait_listed(backend: &mut MacosBackend, id: &str) {
    let started = Instant::now();
    loop {
        if backend
            .windows()
            .map(|windows| windows.iter().any(|window| window.id == id))
            .unwrap_or(false)
        {
            return;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "window {id} never appeared in the backend's window list"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}
