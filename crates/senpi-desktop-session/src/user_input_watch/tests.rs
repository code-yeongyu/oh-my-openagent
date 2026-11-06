use senpi_desktop_core::protocol_params::CaptureParams;
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::json;

use super::reads_or_acts_on_an_app;
use crate::request::Op;
use crate::test_support::harness;

fn capture(target: &str) -> Op {
    Op::Capture(CaptureParams {
        target: target.to_owned(),
        caps: None,
        exclude_window_titles: None,
    })
}

#[test]
fn only_requests_aimed_at_a_window_an_element_or_a_menu_read_or_act_on_an_app() {
    for (op, app) in [
        (capture("101"), true),
        (capture("desktop"), false),
        (capture("display:active"), false),
        (Op::AxFocused, true),
        (Op::Displays, false),
        (Op::Windows, false),
        (Op::ClipboardRead, false),
        (Op::ControlState, false),
    ] {
        assert_eq!(reads_or_acts_on_an_app(&op), app, "{op:?}");
    }
}

#[test]
fn the_first_request_into_an_app_starts_the_watch_once() {
    // Given
    let mut harness = harness(&json!({}));
    harness.process(Op::Displays).unwrap();
    harness.process(Op::Windows).unwrap();
    harness.capture("desktop");
    assert_eq!(harness.watches.count(), 0, "nothing named an app yet");
    // When
    harness.capture("101");
    harness.focused_ref();
    harness.capture("101");
    // Then
    assert_eq!(harness.watches.count(), 1);
    assert!(harness.worker.watching_user_input);
}

#[test]
fn an_accessibility_read_starts_the_watch() {
    let mut harness = harness(&json!({}));
    harness.focused_ref();
    assert_eq!(harness.watches.count(), 1);
}

#[test]
fn a_new_backend_starts_its_own_watch_and_a_cursor_only_change_keeps_the_running_one() {
    // Given
    let mut harness = harness(&json!({}));
    harness.capture("101");
    // When: only the cursor changes, so the backend and its watch stay.
    harness.worker.open(DesktopSessionOptions {
        show_cursor: false,
        ..DesktopSessionOptions::default()
    });
    harness.capture("101");
    // Then
    assert_eq!(harness.watches.count(), 1);
    // When: any other change builds a new backend, whose watch has not started.
    harness.worker.open(DesktopSessionOptions {
        allow_host_relay_only_stop: true,
        ..DesktopSessionOptions::default()
    });
    assert!(!harness.worker.watching_user_input);
    harness.capture("101");
    // Then
    assert_eq!(harness.watches.count(), 2);
}
