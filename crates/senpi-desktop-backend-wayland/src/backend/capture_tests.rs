//! Capture through the fake Screenshot portal: honest capabilities before
//! and after the first screenshot, RGBA decoding, refusal, absence, and the
//! targets the portal cannot serve.

use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::types::{CaptureCaps, DisplaySelector, Target};

use super::tests::backend_without_services;
use super::WaylandBackend;
use crate::capture::screenshot_portal::UNAVAILABLE;
use crate::capture::{PortalCapture, PORTAL_DISPLAY_ID};
use crate::test_support::env_lock;
use crate::test_support::fake_eis::EisConfig;
use crate::test_support::fake_portal::{fake_bus, FakeBus, Mode, Reply, Shot};
use crate::test_support::screenshot_iface::CORNER;

const PNG: Shot = Shot::Png {
    width: 64,
    height: 48,
};

fn portal(screenshot: Shot) -> &'static FakeBus {
    fake_bus(Mode {
        remote_desktop: Reply::Absent,
        global_shortcuts: Reply::Absent,
        screenshot,
        eis: EisConfig { keymap: "", group: 0 },
    })
}

/// A backend whose Screenshot probe has not run yet.
fn backend() -> WaylandBackend {
    WaylandBackend::with_ax(Err(DesktopError::ax_unsupported()))
}

fn capture(backend: &mut WaylandBackend) -> Result<(u32, u32), DesktopError> {
    backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .map(|(image, _)| image.dimensions())
}

#[test]
fn capabilities_report_no_capture_before_probe() {
    // Given: the portal would serve a screenshot
    let _env = env_lock();
    let bus = portal(PNG);
    let mut backend = backend();

    // When
    let caps = backend.capabilities();

    // Then: offered, not proven, and capabilities took no screenshot
    assert!(!caps.capture);
    assert_eq!(caps.capture_permission, "prompt-or-granted");
    assert_eq!(caps.display_count, 0);
    assert!(bus.state.recorded().shots.is_empty());
}

/// oh-my-pi's `capabilities_report_no_capture_without_pipewire_feature`,
/// rewritten for D6: the shipped engine captures through the Screenshot
/// portal (never PipeWire), so `capture` follows the portal probe instead of
/// a Cargo feature, and turns true only once a screenshot came back.
#[test]
fn capabilities_report_capture_from_portal_probe() {
    // Given
    let _env = env_lock();
    portal(PNG);
    let mut backend = backend();

    // When
    let captured = capture(&mut backend);

    // Then
    assert_eq!(captured, Ok((64, 48)));
    let caps = backend.capabilities();
    assert!(caps.capture);
    assert_eq!(caps.capture_permission, "granted");
    assert_eq!(caps.display_count, 1);
}

#[test]
fn a_portal_screenshot_arrives_as_rgba_and_its_file_is_removed() {
    // Given
    let _env = env_lock();
    let bus = portal(PNG);
    let mut backend = backend();

    // When
    let (image, frame) = backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect("portal screenshot");

    // Then: the PNG decoded to RGBA as one scale-1 display, non-interactively
    assert_eq!(image.dimensions(), (64, 48));
    assert_eq!(*image.get_pixel(0, 0), CORNER);
    assert_eq!(frame.map_point(63.0, 47.0, None), Ok((63.0, 47.0)));
    assert!(
        frame.map_point(64.0, 0.0, None).is_err(),
        "the frame is the image"
    );
    let displays = backend.displays().expect("displays");
    let display = displays.first().expect("the portal display");
    assert_eq!(display.id, PORTAL_DISPLAY_ID);
    assert_eq!((display.width, display.height, display.scale), (64, 48, 1.0));
    let recorded = bus.state.recorded();
    assert_eq!(recorded.interactive, Some(false));
    let shot = recorded.shots.first().expect("one screenshot file");
    assert!(!shot.exists(), "{} was left behind", shot.display());
}

#[test]
fn without_the_screenshot_portal_capture_fails_and_is_reported_unavailable() {
    // Given: xdg-desktop-portal has no Screenshot backend
    let _env = env_lock();
    portal(Shot::Absent);
    let mut backend = backend();

    // When
    let error = capture(&mut backend).expect_err("no portal");

    // Then
    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(error.message.starts_with(UNAVAILABLE), "{}", error.message);
    let caps = backend.capabilities();
    assert!(!caps.capture);
    assert_eq!(caps.capture_permission, "unavailable");
}

#[test]
fn a_refused_screenshot_is_permission_denied_and_never_reported_as_capture() {
    // Given: the portal answers response=1
    let _env = env_lock();
    portal(Shot::Deny);
    let mut backend = backend();

    // When
    let error = capture(&mut backend).expect_err("refused");

    // Then
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let caps = backend.capabilities();
    assert!(!caps.capture);
    assert_eq!(caps.capture_permission, "denied");
}

#[test]
fn a_window_target_without_screencast_is_refused_because_the_screenshot_portal_has_no_window_capture() {
    let mut backend = backend_without_services();

    let error = backend
        .capture(&Target::Window("w1".to_owned()), &CaptureCaps::default())
        .expect_err("no window capture");

    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(error.message.starts_with("window w1:"), "{}", error.message);
}

#[test]
fn a_selected_display_other_than_the_portal_display_is_an_invalid_target() {
    let mut backend = backend_without_services();
    backend.capture = PortalCapture::new(DisplaySelector::Id("DP-1".to_owned()));

    let error = capture(&mut backend).expect_err("unknown display");

    assert_eq!(error.code, ErrorCode::InvalidTarget);
}
