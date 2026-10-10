mod common;

use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordedPointer, SinkOp};
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopPoint, DesktopWindow, Target};

fn click(x: f64, y: f64) -> PointerEvent {
    PointerEvent::Click {
        x,
        y,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    }
}

fn frame() -> FrameGeometry {
    FrameGeometry::identity_global()
}

/// The fixture plus an unfocused second window "202".
fn two_window_backend() -> FakeBackend {
    let mut scenario = common::fixture_scenario();
    scenario.windows.push(DesktopWindow {
        id: "202".into(),
        title: "Terminal".into(),
        app: "Terminal".into(),
        pid: Some(77),
        x: 1000,
        y: 100,
        width: 600,
        height: 400,
        focused: false,
        elevated: None,
    });
    FakeBackend::new(scenario)
}

fn focused_id(backend: &mut FakeBackend) -> String {
    let windows = backend.windows().expect("windows");
    windows
        .into_iter()
        .find(|w| w.focused)
        .map(|w| w.id)
        .expect("one focused window")
}

#[test]
fn input_unavailable_scenario_refuses_pointer_and_records_nothing() {
    // Given
    let scenario = FakeScenario::from_json(r#"{"capabilities":{"input":false}}"#).expect("parses");
    let mut backend = FakeBackend::new(scenario);
    let sink = backend.sink();
    // When
    let result = backend.pointer(
        &Target::Desktop,
        click(5.0, 5.0),
        &frame(),
        DeliveryMode::Background,
    );
    // Then
    assert_eq!(result.expect_err("refused").code, ErrorCode::InputFailed);
    assert!(sink.ops().is_empty());
}

#[test]
fn background_window_input_unavailable_is_background_unavailable() {
    let mut scenario = common::fixture_scenario();
    scenario.capabilities.background_window_input = false;
    let mut backend = FakeBackend::new(scenario);
    let target = Target::Window("101".into());
    let err = backend
        .type_text(&target, "hi", DeliveryMode::Background)
        .expect_err("refused");
    assert_eq!(err.code, ErrorCode::BackgroundUnavailable);
    assert!(backend.sink().ops().is_empty());
}

#[test]
fn unadvertised_delivery_mode_is_refused() {
    let json = r#"{"capabilities":{"deliveryModes":["background"]}}"#;
    let mut backend = FakeBackend::new(FakeScenario::from_json(json).expect("parses"));
    let err = backend
        .key_chord(&Target::Desktop, &[KeyName::Enter], DeliveryMode::Foreground)
        .expect_err("refused");
    assert_eq!(err.code, ErrorCode::InputFailed);
}

#[test]
fn background_click_records_the_event_and_keeps_focus_and_cursor() {
    let mut backend = two_window_backend();
    let target = Target::Window("202".into());
    backend
        .pointer(&target, click(1100.0, 150.0), &frame(), DeliveryMode::Background)
        .expect("click");
    assert_eq!(
        backend.sink().ops(),
        vec![SinkOp::Pointer {
            target,
            event: RecordedPointer::Click {
                at: DesktopPoint { x: 1100.0, y: 150.0 },
                button: MouseButton::Left,
                count: 1,
                modifiers: Modifiers::default(),
            },
            mode: DeliveryMode::Background,
        }]
    );
    assert_eq!(focused_id(&mut backend), "101");
    assert_eq!(
        backend.cursor_position().expect("cursor"),
        Some(DesktopPoint { x: 960.0, y: 540.0 })
    );
}

#[test]
fn foreground_click_steals_focus_and_moves_the_cursor() {
    let mut backend = two_window_backend();
    let target = Target::Window("202".into());
    backend
        .pointer(&target, click(1100.0, 150.0), &frame(), DeliveryMode::Foreground)
        .expect("click");
    assert_eq!(focused_id(&mut backend), "202");
    assert_eq!(
        backend.cursor_position().expect("cursor"),
        Some(DesktopPoint { x: 1100.0, y: 150.0 })
    );
}

#[test]
fn front_window_round_trip_restores_the_previous_focus() {
    // Given: the focus guard captured window 101 before a foreground action
    let mut backend = two_window_backend();
    let front = backend.front_window().expect("front").expect("a focused window");
    backend.raise_window("202").expect("raise");
    // When
    backend.restore_front_window(&front).expect("restore");
    // Then
    assert_eq!(focused_id(&mut backend), "101");
    assert_eq!(
        backend.sink().ops(),
        vec![
            SinkOp::QueryFrontWindow,
            SinkOp::RaiseWindow { id: "202".into() },
            SinkOp::RestoreFrontWindow(front),
        ]
    );
}

#[test]
fn release_all_and_warp_are_recorded_in_order() {
    let mut backend = common::fixture_backend();
    let point = DesktopPoint { x: 1.0, y: 2.0 };
    backend.warp_cursor(point).expect("warp");
    backend.release_all().expect("release");
    assert_eq!(
        backend.sink().ops(),
        vec![SinkOp::WarpCursor(point), SinkOp::ReleaseAll]
    );
    assert_eq!(backend.cursor_position().expect("cursor"), Some(point));
}

#[test]
fn input_to_an_unknown_window_is_window_not_found() {
    let mut backend = common::fixture_backend();
    let err = backend
        .type_text(&Target::Window("404".into()), "x", DeliveryMode::Background)
        .expect_err("unknown");
    assert_eq!(err.code, ErrorCode::WindowNotFound);
}

#[test]
fn screen_locked_follows_the_scenario_capability() {
    let json = r#"{"capabilities":{"screenLocked":true}}"#;
    let mut backend = FakeBackend::new(FakeScenario::from_json(json).expect("parses"));
    assert!(backend.screen_locked().expect("probe"));
}
