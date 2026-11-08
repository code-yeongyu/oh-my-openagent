//! Hyprland: the `windowInput` capability probe, and window-targeted pointer
//! input placed at the window's IPC geometry inside the libei output region.

use std::os::unix::net::UnixListener;

use image::{Rgba, RgbaImage};
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DesktopDisplay, Target, WindowInput};

use super::tests::{backend_without_services, FR};
use super::unplaced_frame;
use crate::capture::layout::EisRegion;
use crate::capture::pipewire::crop_window;
use crate::compositor::hyprland::tests::{serve, window, CLIENTS, MONITORS};
use crate::compositor::hyprland::{detect_from, Detection};
use crate::test_support::fake_eis::{EisConfig, FakeEis, Recorded};
use crate::test_support::{env_lock, LibeiSocketEnv};

const DP1: EisRegion = EisRegion {
    x: 0,
    y: 0,
    width: 2560,
    height: 1440,
    scale: 1.0,
};

fn hyprland_at(runtime: &tempfile::TempDir) -> Detection {
    detect_from(Some("sig".into()), Some(runtime.path().into()))
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

#[test]
fn without_libei_socket_or_portal_hyprland_window_input_is_unavailable_with_no_eis() {
    // Given: Hyprland IPC is reachable, but no LIBEI_SOCKET and no RemoteDesktop portal
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let runtime = tempfile::tempdir().expect("runtime dir");
    let _ipc = serve(runtime.path(), "sig", Vec::new());
    let mut backend = backend_without_services();
    backend.compositor = Some(hyprland_at(&runtime));

    // When
    let capabilities = backend.capabilities();

    // Then
    assert!(matches!(backend.compositor, Some(Detection::Ipc(_))));
    assert_eq!(capabilities.window_input, unavailable("no_eis"));
}

#[test]
fn hyprland_with_a_libei_socket_offers_window_input() {
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let _ipc = serve(runtime.path(), "sig", Vec::new());
    let _libei = LibeiSocketEnv::set(Some(&runtime.path().join("eis-0")));
    let mut backend = backend_without_services();
    backend.compositor = Some(hyprland_at(&runtime));

    assert_eq!(
        backend.capabilities().window_input,
        Some(WindowInput {
            available: true,
            reason: None
        })
    );
}

#[test]
fn window_input_is_absent_off_hyprland_and_names_a_missing_ipc_socket() {
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let mut off = backend_without_services();
    off.compositor = Some(Detection::NotHyprland);
    let mut no_socket = backend_without_services();
    no_socket.compositor = Some(hyprland_at(&runtime));

    assert_eq!(off.capabilities().window_input, None);
    assert_eq!(
        no_socket.capabilities().window_input,
        unavailable("hyprland_ipc_missing")
    );
}

#[test]
fn a_window_click_lands_at_the_hyprland_geometry_through_libei() {
    // Given: Hyprland places the terminal (pid 1201) at (10, 48); AT-SPI says (0, 0)
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let ipc = serve(
        runtime.path(),
        "sig",
        vec![("j/clients", CLIENTS), ("j/monitors", MONITORS)],
    );
    let Detection::Ipc(hyprland) = hyprland_at(&runtime) else {
        panic!("socket not detected");
    };
    let socket = runtime.path().join("eis-0");
    let eis = FakeEis::listen_with_regions(
        UnixListener::bind(&socket).expect("bind fake libei socket"),
        EisConfig {
            keymap: FR,
            group: 0,
        },
        vec![DP1],
    );
    let _libei = LibeiSocketEnv::set(Some(&socket));
    let mut backend = backend_without_services();

    // When: a click 100,20 into the window
    let clicked = backend.hyprland_pointer(&hyprland, &window(Some(1201), "~"), click(100.0, 20.0));

    // Then: libei moved to the compositor position before the press
    assert_eq!(clicked, Ok(()));
    assert_eq!(ipc.join().expect("ipc server"), ["j/clients", "j/monitors"]);
    let log = eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events.first(),
        Some(&Recorded::Motion { x: 110.0, y: 68.0 })
    );
}

/// One 1280x1080 monitor at scale 1, ScreenCast-shaped.
pub(super) fn monitor() -> DesktopDisplay {
    DesktopDisplay {
        id: "pipewire-0".to_owned(),
        name: "DP-1".to_owned(),
        x: 0,
        y: 0,
        width: 1280,
        height: 1080,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: 1280,
        pixel_height: 1080,
        is_primary: true,
    }
}

#[test]
fn a_window_frame_and_its_click_agree_on_the_hyprland_rect() {
    // Given: AT-SPI says the terminal (pid 1201) is at (0, 0); Hyprland places it at (10, 48),
    // and the composite marks the pixel Hyprland shows at (10 + 100, 48 + 20)
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let ipc = serve(
        runtime.path(),
        "sig",
        vec![
            ("j/clients", CLIENTS),
            ("j/monitors", MONITORS),
            ("j/clients", CLIENTS),
            ("j/monitors", MONITORS),
        ],
    );
    let Detection::Ipc(hyprland) = hyprland_at(&runtime) else {
        panic!("socket not detected");
    };
    let socket = runtime.path().join("eis-0");
    let eis = FakeEis::listen_with_regions(
        UnixListener::bind(&socket).expect("bind fake libei socket"),
        EisConfig {
            keymap: FR,
            group: 0,
        },
        vec![DP1],
    );
    let _libei = LibeiSocketEnv::set(Some(&socket));
    let atspi = window(Some(1201), "~");
    let (px, py) = (100_u32, 20_u32);
    let mark = Rgba([255, 0, 0, 255]);
    let mut composite = RgbaImage::new(1280, 1080);
    composite.put_pixel(10 + px, 48 + py, mark);

    // When: the window is captured (placed, then cropped), then clicked at pixel (px, py)
    let (windows, unplaced) = hyprland.place_in(vec![atspi.clone()], &atspi.id);
    let (image, frame) =
        crop_window(&composite, &[monitor()], windows, &atspi.id).expect("window cropped");
    let (x, y) = frame
        .map_point(f64::from(px), f64::from(py), Some(&atspi))
        .expect("pixel maps");
    let mut backend = backend_without_services();
    let clicked = backend.hyprland_pointer(&hyprland, &atspi, click(x, y));

    // Then: the frame is cropped at the Hyprland rect, and the click lands on the pixel it shows
    assert!(unplaced.is_none(), "{unplaced:?}");
    assert_eq!(image.dimensions(), (1260, 1012));
    assert_eq!(*image.get_pixel(px, py), mark, "frame pixel (px, py) is Hyprland at + (px, py)");
    assert_eq!(
        frame.map_to_pixel(110.0, 68.0),
        Ok((f64::from(px), f64::from(py))),
        "the frame's logical origin is the Hyprland rect"
    );
    assert_eq!(clicked, Ok(()));
    assert_eq!(
        ipc.join().expect("ipc server"),
        ["j/clients", "j/monitors", "j/clients", "j/monitors"],
        "one clients + monitors read for the capture, one for the click"
    );
    let log = eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events.first(),
        Some(&Recorded::Motion { x: 110.0, y: 68.0 })
    );
}

#[test]
fn a_window_hyprland_cannot_place_gets_a_frame_that_refuses_pointer_input() {
    // Given: the accessibility tree reports no pid for the window
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let _ipc = serve(
        runtime.path(),
        "sig",
        vec![("j/clients", CLIENTS), ("j/monitors", MONITORS)],
    );
    let Detection::Ipc(hyprland) = hyprland_at(&runtime) else {
        panic!("socket not detected");
    };
    let atspi = window(None, "~");

    // When
    let (windows, unplaced) = hyprland.place_in(vec![atspi.clone()], &atspi.id);
    let error = unplaced.expect("an unplaced window is reported");
    let (image, _) = crop_window(&RgbaImage::new(1280, 1080), &[monitor()], windows.clone(), &atspi.id)
        .expect("cropped at the AT-SPI bounds");
    let (_, frame) = unplaced_frame(image, "Hyprland", &error);

    // Then: the window keeps its AT-SPI bounds and no pixel of its frame maps to input
    assert_eq!(windows.as_slice(), std::slice::from_ref(&atspi));
    assert!(error.message.contains("hyprland-window-unresolved"), "{}", error.message);
    let refused = frame.map_point(100.0, 20.0, Some(&atspi)).expect_err("pixels only");
    assert_eq!(refused.code, ErrorCode::InvalidCoordinateFrame);
    assert!(refused.message.contains("Hyprland could not place"), "{}", refused.message);
}

#[test]
fn a_window_click_on_a_covered_point_sends_nothing() {
    // Given: the editor (pid 1302) under its floating Save As dialog
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let _ipc = serve(
        runtime.path(),
        "sig",
        vec![("j/clients", CLIENTS), ("j/monitors", MONITORS)],
    );
    let Detection::Ipc(hyprland) = hyprland_at(&runtime) else {
        panic!("socket not detected");
    };
    let socket = runtime.path().join("eis-0");
    let eis = FakeEis::listen_with_regions(
        UnixListener::bind(&socket).expect("bind fake libei socket"),
        EisConfig {
            keymap: FR,
            group: 0,
        },
        vec![DP1],
    );
    let _libei = LibeiSocketEnv::set(Some(&socket));
    let mut backend = backend_without_services();

    // When: the click falls on the dialog
    let clicked = backend.hyprland_pointer(
        &hyprland,
        &window(Some(1302), "notes.txt"),
        click(300.0, 300.0),
    );

    // Then
    let error = clicked.expect_err("a covered point must be refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(eis.wait_for(|log| log.connected).events.is_empty());
}

#[test]
fn keyboard_input_at_a_window_stays_refused_on_hyprland() {
    let _env = env_lock();
    let runtime = tempfile::tempdir().expect("runtime dir");
    let _ipc = serve(runtime.path(), "sig", Vec::new());
    let mut backend = backend_without_services();
    backend.compositor = Some(hyprland_at(&runtime));

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
}

#[test]
fn window_pointer_off_hyprland_is_refused_before_libei_connects() {
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend_without_services();
    backend.compositor = Some(Detection::NotHyprland);

    let error = backend
        .pointer(
            &Target::Window("w1".to_owned()),
            click(1.0, 1.0),
            &senpi_desktop_core::frame::FrameGeometry::identity_global(),
            DeliveryMode::Background,
        )
        .expect_err("window pointer input off Hyprland must be refused");

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
