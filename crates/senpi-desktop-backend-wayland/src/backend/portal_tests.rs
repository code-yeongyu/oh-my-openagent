//! Input through the fake RemoteDesktop portal (no `LIBEI_SOCKET`): the
//! honest `inputPermission` probe, the `ConnectToEIS` path, refusal, and
//! the no-input-path failure.

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::types::Target;

use super::tests::FR;
use super::WaylandBackend;
use crate::portal::remote_desktop::INPUT_PATH_REQUIRED;
use crate::test_support::fake_eis::{EisConfig, Recorded};
use crate::test_support::fake_portal::{fake_bus, FakeBus, Mode, Reply, Shot};
use crate::test_support::{env_lock, LibeiSocketEnv};

fn portal(remote_desktop: Reply) -> &'static FakeBus {
    fake_bus(Mode {
        remote_desktop,
        global_shortcuts: Reply::Absent,
        screenshot: Shot::Absent,
        eis: EisConfig { keymap: FR, group: 0 },
    })
}

/// A backend whose portal probe has not run yet.
fn backend() -> WaylandBackend {
    WaylandBackend::with_ax(Err(DesktopError::ax_unsupported()))
}

#[test]
fn without_portal_or_libei_socket_input_is_unavailable_and_refused() {
    // Given: a session bus without the RemoteDesktop portal, no LIBEI_SOCKET
    let _env = env_lock();
    portal(Reply::Absent);
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend();

    // When
    let capabilities = backend.capabilities();
    let typed = backend.type_text(&Target::Desktop, "hello", DeliveryMode::Background);

    // Then
    assert_eq!(capabilities.input_permission, "unavailable");
    assert!(!capabilities.input);
    let error = typed.expect_err("input without a path must fail");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error.message.starts_with(INPUT_PATH_REQUIRED),
        "{}",
        error.message
    );
}

#[test]
fn a_granted_remote_desktop_session_types_through_connect_to_eis() {
    // Given: the portal grants keyboard and pointer
    let _env = env_lock();
    let bus = portal(Reply::Grant);
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend();
    let before = backend.capabilities().input_permission;

    // When
    let typed = backend.type_text(&Target::Desktop, "hé", DeliveryMode::Background);

    // Then: the keys arrived at the portal's EIS server and input is granted
    assert_eq!(before, "prompt-or-granted");
    assert_eq!(typed, Ok(()));
    let log = bus
        .state
        .recorded()
        .eis
        .as_ref()
        .expect("ConnectToEIS served")
        .wait_for(|log| log.bursts >= 1);
    let presses: Vec<u32> = log
        .events
        .iter()
        .filter_map(|event| match event {
            Recorded::Key {
                keycode,
                pressed: true,
            } => Some(*keycode),
            _ => None,
        })
        .collect();
    assert_eq!(presses, [35, 3], "h then eacute on the fr keymap");
    assert_eq!(backend.capabilities().input_permission, "granted");
}

#[test]
fn a_refused_remote_desktop_session_is_permission_denied() {
    // Given: the user refuses the RemoteDesktop Start dialog
    let _env = env_lock();
    portal(Reply::Deny);
    let _libei = LibeiSocketEnv::set(None);
    let mut backend = backend();

    // When
    let typed = backend.type_text(&Target::Desktop, "hello", DeliveryMode::Background);

    // Then
    let error = typed.expect_err("a refused session must fail");
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(
        error.message.starts_with("RemoteDesktop permission"),
        "{}",
        error.message
    );
    assert_eq!(backend.capabilities().input_permission, "unavailable");
}
