//! grim capture: argument construction, PNG decode, compositing and the
//! display selector, against the mock runner and the in-memory IPC.

use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DisplaySelector, Target};

use super::test_support::{FakeRunner, FakeSwayIpc};
use crate::capture;

fn runner_with_probe() -> FakeRunner {
    FakeRunner::new(vec![FakeRunner::png(1, 1, [255, 0, 0, 255])])
}

#[test]
fn the_probe_captures_one_layout_pixel() {
    let mut runner = runner_with_probe();
    capture::probe(&mut runner).expect("probe");

    let grim = runner.args_of("grim");
    assert_eq!(
        grim,
        [vec![
            "-t".to_owned(),
            "png".to_owned(),
            "-g".to_owned(),
            "0,0 1x1".to_owned(),
            "-".to_owned()
        ]]
    );
}

#[test]
fn the_probe_fails_when_grim_cannot_run() {
    use crate::command::RunFailure;
    let mut runner = FakeRunner::new(vec![Err(RunFailure::Spawn("grim".to_owned()))]);
    let error = capture::probe(&mut runner).expect_err("no grim");

    assert!(error.message.contains("grim"));
}

#[test]
fn a_single_display_capture_uses_one_grim_output_call() {
    let mut runner = FakeRunner::new(vec![FakeRunner::png(1920, 1200, [10, 20, 30, 255])]);
    let mut ipc = FakeSwayIpc::default();

    let (image, frame) = capture::capture(
        &mut runner,
        &mut ipc,
        &Target::Desktop,
        &DisplaySelector::All,
    )
    .expect("capture desktop");

    assert_eq!((image.width(), image.height()), (1920, 1200));
    let geometry = FrameGeometry::for_displays(&[senpi_desktop_core::types::DesktopDisplay {
        id: "HDMI-A-1".to_owned(),
        name: "RZD HDMI".to_owned(),
        x: 0,
        y: 0,
        width: 1920,
        height: 1200,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: 1920,
        pixel_height: 1200,
        is_primary: false,
    }]);
    assert_eq!(frame, geometry);
    let grim = runner.args_of("grim");
    assert_eq!(
        grim,
        [vec![
            "-t".to_owned(),
            "png".to_owned(),
            "-o".to_owned(),
            "HDMI-A-1".to_owned(),
            "-".to_owned()
        ]]
    );
}

#[test]
fn a_window_capture_crops_at_the_compositor_rect() {
    let mut runner = FakeRunner::new(vec![FakeRunner::png(1880, 1124, [9, 9, 9, 255])]);
    let mut ipc = FakeSwayIpc::default();

    let (image, _frame) = capture::capture(
        &mut runner,
        &mut ipc,
        &Target::Window("12".to_owned()),
        &DisplaySelector::All,
    )
    .expect("capture window");

    assert_eq!((image.width(), image.height()), (1880, 1124));
    let grim = runner.args_of("grim");
    assert_eq!(
        grim,
        [vec![
            "-t".to_owned(),
            "png".to_owned(),
            "-g".to_owned(),
            "20,56 1880x1124".to_owned(),
            "-".to_owned()
        ]]
    );
}

#[test]
fn an_unknown_window_is_not_captured() {
    let mut runner = FakeRunner::new(vec![FakeRunner::png(1, 1, [0, 0, 0, 255])]);
    let mut ipc = FakeSwayIpc::default();

    let error = capture::capture(
        &mut runner,
        &mut ipc,
        &Target::Window("9999".to_owned()),
        &DisplaySelector::All,
    )
    .expect_err("unknown window");

    assert_eq!(
        error.code,
        senpi_desktop_core::error::ErrorCode::WindowNotFound
    );
}

#[test]
fn the_active_selector_resolves_to_the_output_of_the_focused_window() {
    let mut ipc = FakeSwayIpc::default();

    let displays = capture::select_displays(&mut ipc, &DisplaySelector::Active).expect("active");

    assert_eq!(displays.len(), 1);
    assert_eq!(displays[0].id, "HDMI-A-1");
}

#[test]
fn a_named_selector_matches_the_output_case_insensitively() {
    let mut ipc = FakeSwayIpc::default();

    let displays = capture::select_displays(&mut ipc, &DisplaySelector::Id("hdmi-a-1".to_owned()))
        .expect("named");

    assert_eq!(displays.len(), 1);

    let error = capture::select_displays(&mut ipc, &DisplaySelector::Id("nope".to_owned()))
        .expect_err("unknown output");
    assert!(error.message.contains("nope"));
}

#[test]
fn the_all_selector_lists_every_active_output() {
    let mut ipc = FakeSwayIpc::default();

    let displays = capture::select_displays(&mut ipc, &DisplaySelector::All).expect("all");

    assert_eq!(displays.len(), 1);
}
