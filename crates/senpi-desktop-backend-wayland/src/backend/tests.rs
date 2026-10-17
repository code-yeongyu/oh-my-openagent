//! oh-my-pi `linux/wayland/mod.rs` backend tests (:324-438), ported: lazy
//! libei connection, the compositor constraint for window targets, and
//! background-only capabilities.

use std::io::ErrorKind;
use std::os::unix::net::UnixListener;

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::types::Target;

use super::WaylandBackend;
use crate::capture::Probe;
use crate::test_support::fake_eis::{EisConfig, FakeEis};
use crate::test_support::{env_lock, LibeiSocketEnv};

pub const FR: &str = include_str!("../../testdata/fr.xkb");

/// No AT-SPI bus and settled portal probes: no service is touched.
pub fn backend_without_services() -> WaylandBackend {
    let mut backend = WaylandBackend::with_ax(Err(DesktopError::ax_unsupported()));
    backend.portal_offered = Some(false);
    backend.capture.probe = Probe::Absent;
    backend
}

fn socket_dir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("senpi-libei-")
        .tempdir()
        .expect("libei socket dir")
}

#[test]
fn readonly_backend_creation_does_not_connect_to_libei() {
    // Given: LIBEI_SOCKET names a listening socket
    let _env = env_lock();
    let dir = socket_dir();
    let socket = dir.path().join("eis-0");
    let listener = UnixListener::bind(&socket).expect("bind fake libei socket");
    listener.set_nonblocking(true).expect("nonblocking listener");
    let _libei = LibeiSocketEnv::set(Some(&socket));

    // When: the backend is built and asked for its capabilities
    let capabilities = WaylandBackend::with_ax(Err(DesktopError::ax_unsupported())).capabilities();

    // Then: nothing connected, and input is offered but not yet granted
    let pending = listener.accept().map(|_| ()).map_err(|error| error.kind());
    assert_eq!(
        pending,
        Err(ErrorKind::WouldBlock),
        "read-only use connected to libei"
    );
    assert!(capabilities.input);
    assert_eq!(capabilities.input_permission, "prompt-or-granted");
}

#[test]
fn desktop_input_connects_to_libei_lazily() {
    // Given: a fake EIS server behind LIBEI_SOCKET
    let _env = env_lock();
    let dir = socket_dir();
    let socket = dir.path().join("eis-0");
    let eis = FakeEis::listen(
        UnixListener::bind(&socket).expect("bind fake libei socket"),
        EisConfig { keymap: FR, group: 0 },
    );
    let _libei = LibeiSocketEnv::set(Some(&socket));
    let mut backend = backend_without_services();

    // When: the first desktop input arrives
    let typed = backend.type_text(&Target::Desktop, "hello", DeliveryMode::Foreground);

    // Then: it connected, typed, and the grant is now reported
    assert_eq!(typed, Ok(()));
    assert!(eis.wait_for(|log| log.bursts >= 1).connected);
    assert_eq!(backend.capabilities().input_permission, "granted");
}

#[test]
fn window_foreground_delivery_reports_compositor_constraint() {
    let mut backend = backend_without_services();
    let target = Target::Window("w1".to_string());
    let err = backend
        .type_text(&target, "hello", DeliveryMode::Foreground)
        .expect_err("window foreground input must fail");
    assert_eq!(err.code.as_str(), "BackgroundUnavailable");
    assert_eq!(
        err.message,
        "window w1 wayland-compositor-focus-only: Wayland cannot programmatically activate a \
         non-focused window for keyboard input; only the currently focused surface is reachable; \
         use ax actions or desktop input"
    );
}

#[test]
fn window_raise_reports_compositor_constraint() {
    let mut backend = backend_without_services();
    let err = backend
        .raise_window("w1")
        .expect_err("Wayland window raise must fail");
    assert_eq!(err.code.as_str(), "BackgroundUnavailable");
    assert_eq!(
        err.message,
        "window w1 wayland-compositor-focus-only: Wayland cannot programmatically activate a \
         non-focused window; only the currently focused surface is reachable"
    );
}

#[test]
fn capabilities_do_not_advertise_foreground_delivery() {
    let mut backend = backend_without_services();
    let capabilities = backend.capabilities();
    assert_eq!(capabilities.delivery_modes, ["background"]);
    assert!(!capabilities.background_window_input);
    assert_eq!(capabilities.backend, "wayland");
}

#[test]
fn release_all_before_any_input_is_a_no_op() {
    let mut backend = backend_without_services();
    assert_eq!(backend.release_all(), Ok(()));
}
