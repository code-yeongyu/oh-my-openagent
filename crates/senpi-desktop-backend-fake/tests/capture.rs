mod common;

use senpi_desktop_backend_fake::{FakeBackend, FakeMethod, FakeScenario, ResizeWindow};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{CaptureCaps, Target};

#[test]
fn fail_next_fails_exactly_the_next_capture() {
    // Given
    let mut backend = common::fixture_backend();
    backend.fail_next(FakeMethod::Capture, ErrorCode::CaptureFailed);
    // When
    let first = backend.capture(&Target::Desktop, &CaptureCaps::default());
    let second = backend.capture(&Target::Desktop, &CaptureCaps::default());
    // Then
    assert_eq!(first.expect_err("injected").code, ErrorCode::CaptureFailed);
    assert!(second.is_ok());
}

#[test]
fn faults_handle_reaches_a_boxed_backend() {
    let backend = common::fixture_backend();
    let faults = backend.faults();
    let mut boxed: Box<dyn Backend> = Box::new(backend);
    faults.fail_next(FakeMethod::Windows, ErrorCode::Internal);
    assert_eq!(boxed.windows().expect_err("injected").code, ErrorCode::Internal);
    assert!(boxed.displays().is_ok(), "a windows fault leaves displays alone");
}

#[test]
fn desktop_capture_is_a_solid_image_of_the_display_composite() {
    let mut backend = common::fixture_backend();
    let (image, frame) = backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect("capture");
    assert_eq!((image.width(), image.height()), (1920 + 2880, 1800));
    assert_eq!(image.get_pixel(0, 0).0, [32, 96, 160, 255]);
    assert_eq!(image.get_pixel(4799, 1799).0, [32, 96, 160, 255]);
    // Pixel (1920 + 200, 100) on the 2x external display is logical (2020, 50).
    assert_eq!(
        frame.map_point(2120.0, 100.0, None).expect("maps"),
        (2020.0, 50.0)
    );
}

#[test]
fn window_capture_is_one_pixel_per_logical_point() {
    let mut backend = common::fixture_backend();
    let (image, _) = backend
        .capture(&Target::Window("101".into()), &CaptureCaps::default())
        .expect("capture");
    assert_eq!((image.width(), image.height()), (800, 600));
}

#[test]
fn scripted_resize_invalidates_the_previous_window_frame() {
    // Given: window 101 resizes after its next capture
    let mut scenario = common::fixture_scenario();
    scenario.resize_window = Some(ResizeWindow {
        id: "101".into(),
        width: 640,
        height: 480,
    });
    let mut backend = FakeBackend::new(scenario);
    let target = Target::Window("101".into());
    let (_, frame) = backend
        .capture(&target, &CaptureCaps::default())
        .expect("capture");
    // When
    let current = backend.windows().expect("windows");
    // Then
    assert_eq!((current[0].width, current[0].height), (640, 480));
    let err = frame
        .map_point(10.0, 10.0, Some(&current[0]))
        .expect_err("stale frame");
    assert_eq!(err.code, ErrorCode::InvalidCoordinateFrame);
}

#[test]
fn capture_unavailable_scenario_fails_capture() {
    let scenario = FakeScenario::from_json(r#"{"capabilities":{"capture":false}}"#).expect("parses");
    let mut backend = FakeBackend::new(scenario);
    let err = backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect_err("no capture");
    assert_eq!(err.code, ErrorCode::CaptureFailed);
}

#[test]
fn capture_of_an_unknown_window_is_window_not_found() {
    let mut backend = common::fixture_backend();
    let err = backend
        .capture(&Target::Window("404".into()), &CaptureCaps::default())
        .expect_err("unknown window");
    assert_eq!(err.code, ErrorCode::WindowNotFound);
}

#[test]
fn oversized_composite_fails_before_allocating() {
    let json = r#"{"displays":[{"id":"1","name":"huge","x":0,"y":0,"width":20000,"height":20000,
        "scale":1.0,"pixelX":0,"pixelY":0,"pixelWidth":20000,"pixelHeight":20000,"isPrimary":true}]}"#;
    let mut backend = FakeBackend::new(FakeScenario::from_json(json).expect("parses"));
    let err = backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect_err("too big");
    assert_eq!(err.code, ErrorCode::CaptureFailed);
}
