//! KWin: the `windowInput` capability probe, and window-targeted pointer
//! input placed at the geometry a read-only KWin script reports, inside the
//! libei output region.

use std::os::unix::net::UnixListener;

use image::{Rgba, RgbaImage};
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{Target, WindowInput};

use super::hyprland_tests::monitor;
use super::tests::{backend_without_services, FR};
use super::{place_captured, unplaced_frame};
use crate::capture::layout::EisRegion;
use crate::capture::pipewire::crop_window;
use crate::compositor::hyprland::tests::window;
use crate::compositor::kwin::tests::WINDOWS;
use crate::compositor::kwin::{detect_with, Detection};
use crate::test_support::fake_eis::{EisConfig, FakeEis, Recorded};
use crate::test_support::fake_kwin::FakeKwin;
use crate::test_support::{env_lock, LibeiSocketEnv};

const SCREEN: EisRegion = EisRegion {
    x: 0,
    y: 0,
    width: 2560,
    height: 1440,
    scale: 1.0,
};

fn scripting(kwin: &FakeKwin) -> Detection {
    detect_with(Some("KDE".into()), || kwin.connect())
}

fn unavailable(reason: &str) -> Option<WindowInput> {
    Some(WindowInput {
        available: false,
        reason: Some(reason.to_owned()),
    })
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

fn fake_eis(dir: &tempfile::TempDir) -> (FakeEis, LibeiSocketEnv) {
    let socket = dir.path().join("eis-0");
    let eis = FakeEis::listen_with_regions(
        UnixListener::bind(&socket).expect("bind fake libei socket"),
        EisConfig {
            keymap: FR,
            group: 0,
        },
        vec![SCREEN],
    );
    (eis, LibeiSocketEnv::set(Some(&socket)))
}

#[test]
fn kwin_scripting_with_a_libei_socket_offers_window_input() {
    // Given: KWin answers on D-Bus and LIBEI_SOCKET names the fake EIS server
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let dir = tempfile::tempdir().expect("socket dir");
    let (_eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();
    backend.kwin = Some(scripting(&kwin));

    // When
    let capabilities = backend.capabilities();

    // Then
    assert_eq!(
        capabilities.window_input,
        Some(WindowInput {
            available: true,
            reason: None
        })
    );
}

#[test]
fn without_libei_socket_or_portal_kwin_window_input_is_unavailable_with_no_eis() {
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let kwin = FakeKwin::serve(WINDOWS);
    let mut backend = backend_without_services();
    backend.kwin = Some(scripting(&kwin));

    assert_eq!(backend.capabilities().window_input, unavailable("no_eis"));
}

#[test]
fn a_kde_session_without_kwin_dbus_reports_kwin_dbus_missing() {
    // Given: a KDE session whose bus has no org.kde.KWin
    let _env = env_lock();
    let dir = tempfile::tempdir().expect("socket dir");
    let (_eis, _libei) = fake_eis(&dir);
    let bus = FakeKwin::bus_only();
    let mut backend = backend_without_services();
    backend.kwin = Some(detect_with(Some("KDE".into()), || bus.connect()));

    // When / Then: an input path alone does not make window input available
    assert_eq!(
        backend.capabilities().window_input,
        unavailable("kwin_dbus_missing")
    );
}

#[test]
fn a_window_click_lands_at_the_kwin_geometry_through_libei() {
    // Given: KWin places the terminal (pid 1201) at (10, 48); AT-SPI says (0, 0)
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let Detection::Scripting(scripting) = scripting(&kwin) else {
        panic!("kwin scripting not detected");
    };
    let dir = tempfile::tempdir().expect("socket dir");
    let (eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();

    // When: a click 100,20 into the window
    let clicked = backend.kwin_pointer(
        &scripting,
        &window(Some(1201), "~ : bash"),
        click(100.0, 20.0),
    );

    // Then: libei moved to the compositor position before the press
    assert_eq!(clicked, Ok(()));
    let log = eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events.first(),
        Some(&Recorded::Motion { x: 110.0, y: 68.0 })
    );
}

fn script_runs(kwin: &FakeKwin) -> usize {
    kwin.calls().iter().filter(|call| call.method == "run").count()
}

#[test]
fn a_window_frame_and_its_click_agree_on_the_kwin_rect() {
    // Given: AT-SPI says the terminal (pid 1201) is at (0, 0); KWin places it at (10, 48),
    // and the composite marks the pixel KWin shows at (10 + 100, 48 + 20)
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let Detection::Scripting(scripting) = scripting(&kwin) else {
        panic!("kwin scripting not detected");
    };
    let dir = tempfile::tempdir().expect("socket dir");
    let (eis, _libei) = fake_eis(&dir);
    let atspi = window(Some(1201), "~ : bash");
    let target = Target::Window(atspi.id.clone());
    let (px, py) = (100_u32, 20_u32);
    let mark = Rgba([255, 0, 0, 255]);
    let mut composite = RgbaImage::new(1280, 1080);
    composite.put_pixel(10 + px, 48 + py, mark);
    let mut backend = backend_without_services();
    backend.kwin = Some(Detection::Scripting(scripting.clone()));

    // When: the window is captured the way `capture` places it, then clicked at pixel (px, py)
    let geometry = backend.capture_geometry(&target);
    let (windows, unplaced) = place_captured(geometry.as_ref(), vec![atspi.clone()], &target);
    let (image, frame) =
        crop_window(&composite, &[monitor()], windows, &atspi.id).expect("window cropped");
    let (x, y) = frame
        .map_point(f64::from(px), f64::from(py), Some(&atspi))
        .expect("pixel maps");
    let clicked = backend.kwin_pointer(&scripting, &atspi, click(x, y));

    // Then: the frame is cropped at the KWin rect, and the click lands on the pixel it shows
    assert!(unplaced.is_none(), "{unplaced:?}");
    assert_eq!(*image.get_pixel(px, py), mark, "frame pixel (px, py) is the KWin rect + (px, py)");
    assert_eq!(
        frame.map_to_pixel(110.0, 68.0),
        Ok((f64::from(px), f64::from(py))),
        "the frame's logical origin is the KWin rect"
    );
    assert_eq!(clicked, Ok(()));
    assert_eq!(script_runs(&kwin), 2, "one script run for the capture, one for the click");
    let log = eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events.first(),
        Some(&Recorded::Motion { x: 110.0, y: 68.0 })
    );
}

#[test]
fn a_window_kwin_cannot_place_gets_a_frame_that_refuses_pointer_input() {
    // Given: the accessibility tree reports no pid for the window
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let atspi = window(None, "~ : bash");
    let target = Target::Window(atspi.id.clone());
    let mut backend = backend_without_services();
    backend.kwin = Some(scripting(&kwin));

    // When
    let geometry = backend.capture_geometry(&target);
    let (windows, unplaced) = place_captured(geometry.as_ref(), vec![atspi.clone()], &target);
    let (compositor, error) = unplaced.expect("an unplaced window is reported");
    let (image, _) = crop_window(&RgbaImage::new(1280, 1080), &[monitor()], windows.clone(), &atspi.id)
        .expect("cropped at the AT-SPI bounds");
    let (_, frame) = unplaced_frame(image, compositor, &error);

    // Then: the window keeps its AT-SPI bounds and no pixel of its frame maps to input
    assert_eq!(windows.as_slice(), std::slice::from_ref(&atspi));
    assert!(error.message.contains("kwin-window-unresolved"), "{}", error.message);
    let refused = frame.map_point(100.0, 20.0, Some(&atspi)).expect_err("pixels only");
    assert_eq!(refused.code, ErrorCode::InvalidCoordinateFrame);
    assert!(refused.message.contains("KWin could not place"), "{}", refused.message);
}

#[test]
fn a_window_click_on_a_point_a_higher_window_covers_sends_nothing() {
    // Given: the editor (pid 1302) under its Save As dialog
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let Detection::Scripting(scripting) = scripting(&kwin) else {
        panic!("kwin scripting not detected");
    };
    let dir = tempfile::tempdir().expect("socket dir");
    let (eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();

    // When: the click falls on the dialog
    let clicked = backend.kwin_pointer(
        &scripting,
        &window(Some(1302), "notes.txt - Kate"),
        click(300.0, 300.0),
    );

    // Then
    let error = clicked.expect_err("a covered point must be refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(eis.wait_for(|log| log.connected).events.is_empty());
}

#[test]
fn a_kwin_that_runs_the_script_at_neither_object_path_stops_offering_window_input() {
    // Given: KWin loads the script but serves it at no path `run` reaches
    let _env = env_lock();
    let kwin = FakeKwin::unrunnable(WINDOWS);
    let dir = tempfile::tempdir().expect("socket dir");
    let (_eis, _libei) = fake_eis(&dir);
    let Detection::Scripting(scripting) = scripting(&kwin) else {
        panic!("kwin scripting not detected");
    };
    let mut backend = backend_without_services();
    backend.kwin = Some(Detection::Scripting(scripting.clone()));

    // When: one placement has tried both object paths
    let error = backend
        .kwin_pointer(
            &scripting,
            &window(Some(1201), "~ : bash"),
            click(20.0, 60.0),
        )
        .expect_err("no object path runs the script");

    // Then: the refusal is typed and the capability says why
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert_eq!(
        backend.capabilities().window_input,
        unavailable("kwin_script_unrunnable")
    );
}

#[test]
fn keyboard_input_at_a_window_stays_refused_on_kwin() {
    let _env = env_lock();
    let kwin = FakeKwin::serve(WINDOWS);
    let mut backend = backend_without_services();
    backend.kwin = Some(scripting(&kwin));

    let typed = backend.type_text(
        &Target::Window("w1".to_owned()),
        "hi",
        DeliveryMode::Background,
    );

    let error = typed.expect_err("window keyboard input must be refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("wayland-compositor-focus-only"),
        "{}",
        error.message
    );
    assert!(kwin.calls().is_empty(), "no script ran for a refused send");
}

#[test]
fn window_pointer_without_kwin_dbus_is_refused_before_libei_connects() {
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend_without_services();
    backend.kwin = Some(Detection::DbusMissing);

    let error = backend
        .pointer(
            &Target::Window("w1".to_owned()),
            click(1.0, 1.0),
            &FrameGeometry::identity_global(),
            DeliveryMode::Background,
        )
        .expect_err("window pointer input without KWin D-Bus must be refused");

    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("wayland-compositor-focus-only"),
        "{}",
        error.message
    );
    assert_eq!(
        backend.capabilities().input_permission,
        "unavailable",
        "no connect was tried"
    );
}
