//! Live checks against the real window server. `#[ignore]`d: they need a
//! logged-in macOS session with Accessibility (and, for window resolution,
//! Screen Recording) granted to the launcher. Run with `--ignored --nocapture`;
//! each prints machine-read `key=value` facts for the QA evidence. Every fact
//! comes from an independent observer process, never the backend's own state.

mod observer;
mod qa;
pub(crate) mod setup;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DisplaySelector, Target};

use crate::backend::MacosBackend;
use observer::{cursor, frontmost, wait_terminal_contains};
use setup::{
    assert_no_windows, bring_terminal_front, close_focused_window, open_textedit_document,
    post_hid_character, post_hid_key, wait_listed, BACKSPACE,
};

fn backend() -> MacosBackend {
    MacosBackend::new(DisplaySelector::All).expect("macOS backend")
}

fn click(x: f64, y: f64) -> PointerEvent {
    PointerEvent::Click {
        x,
        y,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    }
}

/// The center of a window, in global logical coordinates.
fn center(window: &senpi_desktop_core::types::DesktopWindow) -> (f64, f64) {
    (
        f64::from(window.x) + f64::from(window.width) / 2.0,
        f64::from(window.y) + f64::from(window.height) / 2.0,
    )
}

#[test]
#[ignore = "live: needs Accessibility + Screen Recording grants and a TextEdit-free desktop"]
fn background_click_keeps_frontmost_app() {
    assert_no_windows("com.apple.TextEdit");
    let dir = tempfile::tempdir().unwrap();
    let title = format!("senpi-input-live-{}.txt", std::process::id());
    let window = open_textedit_document(&dir, &title);
    let (terminal_pid, opened_terminal) = bring_terminal_front();
    let mut backend = backend();
    wait_listed(&mut backend, &window.id);
    let front = backend
        .front_window()
        .expect("front window")
        .expect("Terminal front");
    let before = frontmost().expect("observer");
    let (cx, cy) = cursor().expect("cursor observer");

    backend
        .pointer(
            &Target::Window(window.id.clone()),
            click(center(&window).0, center(&window).1),
            &FrameGeometry::identity_global(),
            DeliveryMode::Background,
        )
        .expect("background click");
    backend
        .type_text(
            &Target::Window(window.id.clone()),
            "senpi",
            DeliveryMode::Background,
        )
        .expect("background type");
    backend.restore_key_focus(&front).expect("key focus restore");

    let after = frontmost().expect("observer");
    let (ax, ay) = cursor().expect("cursor observer");
    let text = crate::ax::text_area_value(&window).unwrap_or_default();
    println!(
        "frontmost_before={} frontmost_after={} focused_title_before='{}' focused_title_after='{}'",
        before.pid, after.pid, before.focused_title, after.focused_title
    );
    println!("cursor_before=({cx},{cy}) cursor_after=({ax},{ay})");
    println!("textedit_ax_value={text:?}");
    assert_eq!(before.pid, after.pid, "frontmost app changed");
    // Titles are printed as facts, not asserted: the runner's own Terminal tab
    // title tracks its foreground child (the observer), flipping between
    // snapshots without any focus change.
    assert_eq!((cx, cy), (ax, ay), "cursor moved");
    assert_eq!(
        text, "senpi",
        "the background click+type never reached the document"
    );

    post_hid_character('z');
    let buffer = wait_terminal_contains(terminal_pid, "z").expect("the HID key never landed");
    println!(
        "hid_key_landed_in=Terminal buffer_tail={:?}",
        buffer.trim_end().chars().rev().take(20).collect::<String>()
    );
    post_hid_key(BACKSPACE);
    crate::ax::close_window(&window).expect("TextEdit teardown");
    if opened_terminal {
        close_focused_window(terminal_pid);
    }
}

#[test]
#[ignore = "live: needs Accessibility + Screen Recording grants and a TextEdit-free desktop"]
fn background_keys_into_sole_window_restore_key_focus() {
    assert_no_windows("com.apple.TextEdit");
    let dir = tempfile::tempdir().unwrap();
    let title = format!("senpi-input-keys-{}.txt", std::process::id());
    let window = open_textedit_document(&dir, &title);
    let (terminal_pid, opened_terminal) = bring_terminal_front();
    let mut backend = backend();
    wait_listed(&mut backend, &window.id);
    let front = backend
        .front_window()
        .expect("front window")
        .expect("Terminal front");
    let before = frontmost().expect("observer");

    backend
        .type_text(
            &Target::Window(window.id.clone()),
            "ok15",
            DeliveryMode::Background,
        )
        .expect("background type into the sole window");
    let focused_during = frontmost().expect("observer");
    backend.restore_key_focus(&front).expect("key focus restore");
    let after = frontmost().expect("observer");

    println!("frontmost_before={} frontmost_after={}", before.pid, after.pid);
    println!(
        "terminal_focused_title_before='{}' during='{}' after='{}'",
        before.focused_title, focused_during.focused_title, after.focused_title
    );
    println!(
        "textedit_ax_value={:?}",
        crate::ax::text_area_value(&window).unwrap_or_default()
    );
    assert_eq!(before.pid, after.pid);

    post_hid_character('q');
    assert!(
        wait_terminal_contains(terminal_pid, "q").is_some(),
        "the next HID key did not land in Terminal"
    );
    println!("next_hid_key_landed_in=Terminal");
    post_hid_key(BACKSPACE);
    crate::ax::close_window(&window).expect("TextEdit teardown");
    if opened_terminal {
        close_focused_window(terminal_pid);
    }
}

#[test]
#[ignore = "live: needs Accessibility + Screen Recording grants and a TextEdit-free desktop"]
fn foreground_click_restores_previous_front() {
    assert_no_windows("com.apple.TextEdit");
    let dir = tempfile::tempdir().unwrap();
    let title = format!("senpi-input-fg-{}.txt", std::process::id());
    let window = open_textedit_document(&dir, &title);
    let (terminal_pid, opened_terminal) = bring_terminal_front();
    let mut backend = backend();
    wait_listed(&mut backend, &window.id);
    let front = backend
        .front_window()
        .expect("front window")
        .expect("Terminal front");
    let before = frontmost().expect("observer");
    let (cx, cy) = cursor().expect("cursor observer");

    backend
        .pointer(
            &Target::Window(window.id.clone()),
            click(center(&window).0, center(&window).1),
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .expect("foreground click");
    backend.restore_front_window(&front).expect("front restore");
    backend
        .warp_cursor(senpi_desktop_core::types::DesktopPoint { x: cx, y: cy })
        .expect("cursor restore");

    let after = frontmost().expect("observer");
    let (ax, ay) = cursor().expect("cursor observer");
    let focus_restored = after.pid == before.pid;
    println!(
        "frontmost_before={} frontmost_after={} focus_restored={focus_restored}",
        before.pid, after.pid
    );
    println!("cursor_before=({cx},{cy}) cursor_after=({ax},{ay})");
    assert!(
        focus_restored,
        "foreground delivery did not restore the previous front app"
    );
    crate::ax::close_window(&window).expect("TextEdit teardown");
    if opened_terminal {
        close_focused_window(terminal_pid);
    }
}
