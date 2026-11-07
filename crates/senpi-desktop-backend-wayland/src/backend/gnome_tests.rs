//! GNOME: the `windowInput` capability probe, and window-targeted pointer
//! input placed at the geometry the window-rect shell extension reports,
//! inside the libei output region.

use std::os::unix::net::UnixListener;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{Target, WindowInput};

use super::tests::{backend_without_services, FR};
use crate::capture::layout::EisRegion;
use crate::compositor::gnome::tests::WINDOWS;
use crate::compositor::gnome::{detect_with, Detection};
use crate::compositor::hyprland::tests::window;
use crate::test_support::fake_eis::{EisConfig, FakeEis, Recorded};
use crate::test_support::fake_gnome::FakeGnome;
use crate::test_support::{env_lock, LibeiSocketEnv};

const SCREEN: EisRegion = EisRegion {
    x: 0,
    y: 0,
    width: 2560,
    height: 1440,
    scale: 1.0,
};

fn extension(shell: &FakeGnome) -> Detection {
    detect_with(Some("GNOME".into()), || shell.connect())
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
fn the_gnome_extension_with_a_libei_socket_offers_window_input() {
    // Given: the extension answers on D-Bus and LIBEI_SOCKET names the fake EIS server
    let _env = env_lock();
    let shell = FakeGnome::serve(WINDOWS);
    let dir = tempfile::tempdir().expect("socket dir");
    let (_eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();
    backend.gnome = Some(extension(&shell));

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
fn without_libei_socket_or_portal_gnome_window_input_is_unavailable_with_no_eis() {
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let shell = FakeGnome::serve(WINDOWS);
    let mut backend = backend_without_services();
    backend.gnome = Some(extension(&shell));

    assert_eq!(backend.capabilities().window_input, unavailable("no_eis"));
}

#[test]
fn a_gnome_session_without_the_extension_reports_gnome_extension_missing() {
    // Given: a GNOME session whose shell runs without the extension
    let _env = env_lock();
    let dir = tempfile::tempdir().expect("socket dir");
    let (_eis, _libei) = fake_eis(&dir);
    let shell = FakeGnome::shell_without_extension();
    let mut backend = backend_without_services();
    backend.gnome = Some(extension(&shell));

    // When / Then: an input path alone does not make window input available
    assert_eq!(
        backend.capabilities().window_input,
        unavailable("gnome_extension_missing")
    );
}

#[test]
fn a_window_click_lands_at_the_gnome_geometry_through_libei() {
    // Given: GNOME places the terminal (pid 1201) at (10, 48); AT-SPI says (0, 0)
    let _env = env_lock();
    let shell = FakeGnome::serve(WINDOWS);
    let Detection::Extension(gnome) = extension(&shell) else {
        panic!("gnome extension not detected");
    };
    let dir = tempfile::tempdir().expect("socket dir");
    let (eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();

    // When: a click 100,20 into the window
    let clicked =
        backend.gnome_pointer(&gnome, &window(Some(1201), "~ : bash"), click(100.0, 20.0));

    // Then: libei moved to the compositor position before the press
    assert_eq!(clicked, Ok(()));
    let log = eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events.first(),
        Some(&Recorded::Motion { x: 110.0, y: 68.0 })
    );
}

#[test]
fn a_window_click_on_a_point_a_higher_window_covers_sends_nothing() {
    // Given: the editor (pid 1302) under its Save As dialog
    let _env = env_lock();
    let shell = FakeGnome::serve(WINDOWS);
    let Detection::Extension(gnome) = extension(&shell) else {
        panic!("gnome extension not detected");
    };
    let dir = tempfile::tempdir().expect("socket dir");
    let (eis, _libei) = fake_eis(&dir);
    let mut backend = backend_without_services();

    // When: the click falls on the dialog
    let clicked = backend.gnome_pointer(
        &gnome,
        &window(Some(1302), "notes.txt - Text Editor"),
        click(300.0, 300.0),
    );

    // Then
    let error = clicked.expect_err("a covered point must be refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(eis.wait_for(|log| log.connected).events.is_empty());
}

#[test]
fn keyboard_input_at_a_window_stays_refused_on_gnome() {
    let _env = env_lock();
    let shell = FakeGnome::serve(WINDOWS);
    let mut backend = backend_without_services();
    backend.gnome = Some(extension(&shell));

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
    assert_eq!(
        shell.list_calls(),
        0,
        "no window list was read for a refused send"
    );
}

#[test]
fn window_pointer_without_the_extension_is_refused_before_libei_connects() {
    let _env = env_lock();
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend_without_services();
    backend.gnome = Some(Detection::ExtensionMissing);

    let error = backend
        .pointer(
            &Target::Window("w1".to_owned()),
            click(1.0, 1.0),
            &FrameGeometry::identity_global(),
            DeliveryMode::Background,
        )
        .expect_err("window pointer input without the extension must be refused");

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

#[test]
fn kwin_keeps_precedence_and_gnome_is_not_probed_on_a_kde_session() {
    let _env = env_lock();
    let mut backend = backend_without_services();
    backend.kwin = Some(crate::compositor::kwin::Detection::DbusMissing);
    backend.gnome = None;

    assert_eq!(
        backend.capabilities().window_input,
        unavailable("kwin_dbus_missing")
    );
    assert!(backend.gnome.is_none(), "the GNOME probe never ran");
}
