//! A Screenshot-portal frame takes its logical geometry from the connected
//! libei session's regions when the image is exactly that layout, stays
//! pixels-only otherwise, never opens an input session itself, and refuses
//! pointer input once the layout it was derived from has changed.

use std::io::ErrorKind;
use std::os::unix::net::UnixListener;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{CaptureCaps, Target};

use super::tests::FR;
use super::WaylandBackend;
use crate::capture::layout::EisRegion;
use crate::capture::PORTAL_DISPLAY_ID;
use crate::test_support::fake_eis::{EisConfig, FakeEis, Recorded};
use crate::test_support::fake_portal::{fake_bus, Mode, Reply, Shot};
use crate::test_support::{env_lock, LibeiSocketEnv};

const HIDPI_SHOT: Shot = Shot::Png {
    width: 128,
    height: 96,
};

const fn region(width: u32, height: u32, scale: f32) -> EisRegion {
    EisRegion {
        x: 0,
        y: 0,
        width,
        height,
        scale,
    }
}

struct Scaled {
    eis: FakeEis,
    backend: WaylandBackend,
    _socket: LibeiSocketEnv,
    _dir: tempfile::TempDir,
}

/// The portal serves `shot`; libei is connected and covers `regions`.
fn connected(shot: Shot, regions: Vec<EisRegion>) -> Scaled {
    fake_bus(Mode {
        remote_desktop: Reply::Absent,
        global_shortcuts: Reply::Absent,
        screenshot: shot,
        eis: EisConfig { keymap: FR, group: 0 },
    });
    let dir = tempfile::Builder::new().prefix("senpi-libei-").tempdir().expect("socket dir");
    let socket = dir.path().join("eis-0");
    let listener = UnixListener::bind(&socket).expect("bind");
    let eis = FakeEis::listen_with_regions(listener, EisConfig { keymap: FR, group: 0 }, regions);
    let socket_env = LibeiSocketEnv::set(Some(&socket));
    let mut backend = WaylandBackend::with_ax(Err(DesktopError::ax_unsupported()));
    backend.prepare_input(&Target::Desktop, "test input").expect("libei connected");
    Scaled {
        eis,
        backend,
        _socket: socket_env,
        _dir: dir,
    }
}

fn desktop_frame(backend: &mut WaylandBackend) -> FrameGeometry {
    backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect("portal screenshot")
        .1
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

fn motions(events: &[Recorded]) -> Vec<(f32, f32)> {
    events
        .iter()
        .filter_map(|event| match event {
            Recorded::Motion { x, y } => Some((*x, *y)),
            _ => None,
        })
        .collect()
}

#[test]
fn a_screenshot_matching_the_eis_layout_at_2x_clicks_the_logical_point() {
    // Given: a 200% output, 64x48 logical, screenshotted as 128x96 pixels
    let _env = env_lock();
    let mut scaled = connected(HIDPI_SHOT, vec![region(64, 48, 2.0)]);

    // When
    let frame = desktop_frame(&mut scaled.backend);
    let point = frame.map_point(100.0, 50.0, None);

    // Then: pixel (100, 50) is logical (50, 25), and the click lands there
    assert_eq!(point, Ok((50.0, 25.0)));
    let displays = scaled.backend.displays().expect("displays");
    let summary: Vec<_> = displays.iter().map(|d| (d.id.as_str(), d.width, d.scale)).collect();
    assert_eq!(summary, [(PORTAL_DISPLAY_ID, 64, 2.0)]);
    let clicked = scaled
        .backend
        .pointer(&Target::Desktop, click(50.0, 25.0), &frame, DeliveryMode::Background);
    assert_eq!(clicked, Ok(()));
    let log = scaled.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(motions(&log.events), [(50.0, 25.0)]);
}

#[test]
fn a_screenshot_matching_no_eis_layout_stays_pixels_only() {
    // Given: the EIS region claims 150%, the screenshot is 200%-sized
    let _env = env_lock();
    let mut scaled = connected(HIDPI_SHOT, vec![region(64, 48, 1.5)]);

    // When
    let frame = desktop_frame(&mut scaled.backend);

    // Then
    assert_eq!(
        frame.map_point(10.0, 10.0, None).map_err(|error| error.code),
        Err(ErrorCode::InvalidCoordinateFrame)
    );
}

#[test]
fn capture_never_opens_an_input_session_to_learn_the_layout() {
    // Given: libei is reachable, but no input was sent yet
    let _env = env_lock();
    fake_bus(Mode {
        remote_desktop: Reply::Absent,
        global_shortcuts: Reply::Absent,
        screenshot: HIDPI_SHOT,
        eis: EisConfig { keymap: FR, group: 0 },
    });
    let dir = tempfile::Builder::new().prefix("senpi-libei-").tempdir().expect("socket dir");
    let socket = dir.path().join("eis-0");
    let listener = UnixListener::bind(&socket).expect("bind");
    listener.set_nonblocking(true).expect("nonblocking listener");
    let _libei = LibeiSocketEnv::set(Some(&socket));
    let mut backend = WaylandBackend::with_ax(Err(DesktopError::ax_unsupported()));

    // When
    let frame = desktop_frame(&mut backend);

    // Then: nothing connected, and the frame refuses coordinate input
    let pending = listener.accept().map(|_| ()).map_err(|error| error.kind());
    assert_eq!(pending, Err(ErrorKind::WouldBlock), "capture connected to libei");
    assert_eq!(
        frame.map_point(10.0, 10.0, None).map_err(|error| error.code),
        Err(ErrorCode::InvalidCoordinateFrame)
    );
}

fn qa_layout() -> EisRegion {
    let layout = std::env::var("SENPI_WAYLAND_QA_LAYOUT").expect("precondition: SENPI_WAYLAND_QA_LAYOUT=x,y,w,h,scale");
    let fields: Vec<f64> = layout.split(',').map(|field| field.parse().expect("number")).collect();
    let whole = |value: f64| u32::try_from(value.round() as i64).expect("non-negative");
    EisRegion {
        x: whole(fields[0]),
        y: whole(fields[1]),
        width: whole(fields[2]),
        height: whole(fields[3]),
        scale: fields[4] as f32,
    }
}

/// A real portal screenshot against a fake EIS announcing `layout`.
fn live_frame(layout: EisRegion) -> (u32, u32, FrameGeometry) {
    let dir = tempfile::Builder::new().prefix("senpi-libei-").tempdir().expect("socket dir");
    let socket = dir.path().join("eis-0");
    let _eis = FakeEis::listen_with_regions(UnixListener::bind(&socket).expect("bind"), EisConfig { keymap: FR, group: 0 }, vec![layout]);
    let _socket = LibeiSocketEnv::set(Some(&socket));
    let mut backend = WaylandBackend::new(senpi_desktop_core::types::DisplaySelector::All);
    backend.prepare_input(&Target::Desktop, "qa input").expect("libei connected");
    let (image, frame) = backend.capture(&Target::Desktop, &CaptureCaps::default()).expect("portal screenshot");
    (image.width(), image.height(), frame)
}

#[test]
#[ignore = "live: needs a Wayland session with a Screenshot portal and SENPI_WAYLAND_QA_LAYOUT"]
fn live_portal_screenshot_maps_through_the_compositor_layout() {
    let layout = qa_layout();
    let (width, height, frame) = live_frame(layout);
    let pixel = (f64::from(width) * 0.75, f64::from(height) * 0.5);
    let mapped = frame.map_point(pixel.0, pixel.1, None);
    println!("QA_MATCH layout={layout:?} image={width}x{height} pixel={pixel:?} mapped={mapped:?}");
    let expected = (
        f64::from(layout.x) + f64::from(layout.width) * 0.75,
        f64::from(layout.y) + f64::from(layout.height) * 0.5,
    );
    let (x, y) = mapped.expect("the image is the compositor layout, so it maps");
    assert!((x - expected.0).abs() <= 1.0 && (y - expected.1).abs() <= 1.0, "{expected:?}");
}

#[test]
#[ignore = "live: needs a Wayland session with a Screenshot portal and SENPI_WAYLAND_QA_LAYOUT"]
fn live_portal_screenshot_refuses_a_layout_the_image_is_not() {
    let actual = qa_layout();
    let layout = EisRegion {
        width: actual.width + 100,
        ..actual
    };
    let (width, height, frame) = live_frame(layout);
    let mapped = frame.map_point(1.0, 1.0, None).map_err(|error| error.code);
    println!("QA_MISMATCH layout={layout:?} image={width}x{height} mapped={mapped:?}");
    assert_eq!(mapped, Err(ErrorCode::InvalidCoordinateFrame));
}

#[test]
fn a_layout_change_after_capture_refuses_pointer_input_against_that_frame() {
    // Given: a frame derived from the 64x48 @2x layout, then the layout changes
    let _env = env_lock();
    let mut scaled = connected(HIDPI_SHOT, vec![region(64, 48, 2.0)]);
    let frame = desktop_frame(&mut scaled.backend);
    scaled.eis.replace_pointer(&[region(80, 48, 2.0)]);

    // When: a click through the stale frame, then an AX-style global click
    let stale = scaled
        .backend
        .pointer(&Target::Desktop, click(10.0, 10.0), &frame, DeliveryMode::Background)
        .map_err(|error| error.code);
    let global = scaled.backend.pointer(
        &Target::Desktop,
        click(70.0, 20.0),
        &FrameGeometry::identity_global(),
        DeliveryMode::Background,
    );

    // Then: only the global click reached the compositor
    assert_eq!(stale, Err(ErrorCode::InvalidCoordinateFrame));
    assert_eq!(global, Ok(()));
    let log = scaled.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(motions(&log.events), [(70.0, 20.0)]);
}
