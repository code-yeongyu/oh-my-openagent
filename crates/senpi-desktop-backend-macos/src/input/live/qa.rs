//! QA failure-path scenarios: the canary receipt roundtrip, the multi-window
//! keyboard refusal, and the `SENPI_DESKTOP_DISABLE_SKYLIGHT` test hook.

use std::process::Command;

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DisplaySelector, Target};

use super::observer::frontmost;
use super::setup::{
    assert_no_windows, bring_terminal_front, close_focused_window, open_textedit_document, wait_listed,
};
use super::{backend, center, click};
use crate::backend::MacosBackend;

#[test]
#[ignore = "live: needs an Accessibility grant for the launcher"]
fn canary_receipt_roundtrip() {
    let before = frontmost().expect("observer");
    let mut backend = backend();
    let result = backend.canary().expect("canary receipt");
    let after = frontmost().expect("observer");
    let capabilities = backend.capabilities();
    println!(
        "focus_restored={} frontmost_before={} frontmost_after={} background_window_input={}",
        result.focus_restored, before.pid, after.pid, capabilities.background_window_input
    );
    println!("stop_reason={:?}", capabilities.stop_reason);
    assert!(result.focus_restored, "the canary left focus elsewhere");
    assert_eq!(before.pid, after.pid, "the canary changed the frontmost app");
    // The focused-title equality is printed, not asserted: Terminal's tab
    // title tracks its foreground child (the observer itself), so the middle
    // token legitimately differs between snapshots.
    assert!(capabilities.background_window_input);
    assert_eq!(capabilities.stop_reason, None);
}

#[test]
#[ignore = "live: needs Accessibility + Screen Recording grants and a TextEdit-free desktop"]
fn multi_window_background_keys_refused_without_delivery() {
    assert_no_windows("com.apple.TextEdit");
    let dir = tempfile::tempdir().unwrap();
    let first = format!("senpi-multi-a-{}.txt", std::process::id());
    let second = format!("senpi-multi-b-{}.txt", std::process::id());
    let window_a = open_textedit_document(&dir, &first);
    let window_b = open_textedit_document(&dir, &second);
    let (terminal_pid, opened_terminal) = bring_terminal_front();
    let mut backend = backend();
    wait_listed(&mut backend, &window_a.id);
    wait_listed(&mut backend, &window_b.id);

    // Background clicks stay deliverable (they carry a window id); the plan's
    // refusal is the keyboard rule, so the click runs first and changes nothing.
    backend
        .pointer(
            &Target::Window(window_a.id.clone()),
            click(center(&window_a).0, center(&window_a).1),
            &FrameGeometry::identity_global(),
            DeliveryMode::Background,
        )
        .expect("background click into a multi-window app");
    let error = backend
        .type_text(
            &Target::Window(window_a.id.clone()),
            "x",
            DeliveryMode::Background,
        )
        .expect_err("multi-window background keys must be refused");
    let value_a = crate::ax::text_area_value(&window_a).unwrap_or_default();
    let value_b = crate::ax::text_area_value(&window_b).unwrap_or_default();
    println!("code={} message={}", error.code.as_str(), error.message);
    println!("multi_value_a={value_a:?} multi_value_b={value_b:?}");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("one of 2 windows"),
        "unexpected refusal message"
    );
    assert_eq!(value_a, "", "input leaked into the first document");
    assert_eq!(value_b, "", "input leaked into the second document");
    crate::ax::close_window(&window_a).expect("TextEdit teardown a");
    crate::ax::close_window(&window_b).expect("TextEdit teardown b");
    let _ = terminal_pid;
    if opened_terminal {
        close_focused_window(terminal_pid);
    }
}

/// Re-exec form: the env override must be set before the SPI probe resolves,
/// so the test relaunches its own binary with `SENPI_DESKTOP_DISABLE_SKYLIGHT=1`.
#[test]
#[ignore = "live: needs Accessibility + Screen Recording grants and a TextEdit-free desktop"]
fn disabled_skylight_env_blocks_background_input() {
    if std::env::var("SENPI_DESKTOP_DISABLE_SKYLIGHT").as_deref() == Ok("1") {
        assert_no_windows("com.apple.TextEdit");
        let dir = tempfile::tempdir().unwrap();
        let title = format!("senpi-nospi-{}.txt", std::process::id());
        let window = open_textedit_document(&dir, &title);
        let (terminal_pid, opened_terminal) = bring_terminal_front();
        let mut backend = MacosBackend::new(DisplaySelector::All).expect("backend");
        wait_listed(&mut backend, &window.id);
        let capabilities = backend.capabilities();
        println!(
            "disabled_env_background_window_input={}",
            capabilities.background_window_input
        );
        assert!(!capabilities.background_window_input);
        let error = backend
            .pointer(
                &Target::Window(window.id.clone()),
                click(center(&window).0, center(&window).1),
                &FrameGeometry::identity_global(),
                DeliveryMode::Background,
            )
            .expect_err("background input must be refused without the SPI");
        println!("code={} message={}", error.code.as_str(), error.message);
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
        assert!(error.message.contains("skylight-spi-missing"));
        assert_eq!(
            crate::ax::text_area_value(&window).unwrap_or_default(),
            "",
            "input was delivered without the SPI"
        );
        crate::ax::close_window(&window).expect("TextEdit teardown");
        if opened_terminal {
            close_focused_window(terminal_pid);
        }
        return;
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "input::live::qa::disabled_skylight_env_blocks_background_input",
            "--nocapture",
        ])
        .env("SENPI_DESKTOP_DISABLE_SKYLIGHT", "1")
        .output()
        .expect("relaunch");
    print!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(output.status.success(), "the disabled-SPI child run failed");
}

#[test]
#[ignore = "live: needs an Accessibility grant for the launcher"]
fn canary_off_mode_skips_the_dialog() {
    let mut backend = backend();
    backend.set_canary_mode(crate::CanaryMode::Off);
    let result = backend.canary().expect("canary is a no-op when off");
    let capabilities = backend.capabilities();
    println!(
        "off_mode_focus_restored={} background_window_input={}",
        result.focus_restored, capabilities.background_window_input
    );
    assert!(result.focus_restored);
    assert_eq!(capabilities.stop_reason, None);
}
