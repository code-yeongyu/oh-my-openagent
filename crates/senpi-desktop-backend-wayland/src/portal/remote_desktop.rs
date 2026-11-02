//! The `org.freedesktop.portal.RemoteDesktop` session that hands out a
//! libei socket (`ConnectToEIS`). Never persisted: every engine session asks
//! the compositor again (oh-my-pi #7884 dropped the restore token).

use std::os::unix::net::UnixStream;
use std::time::Duration;

use ashpd::desktop::remote_desktop::{DeviceType, RemoteDesktop};
use ashpd::desktop::{PersistMode, Session};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use tokio::runtime::Runtime;

use super::runtime::CLOSE_TIMEOUT;

/// The message when neither input path exists; the prefix is the contract.
pub const INPUT_PATH_REQUIRED: &str = "RemoteDesktop portal or LIBEI_SOCKET is required for Wayland input";

/// Bound on the presence probe behind `capabilities().inputPermission`.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

type RemoteDesktopSession = Session<'static, RemoteDesktop<'static>>;

/// Which libei devices the user granted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Granted {
    pub pointer: bool,
    pub keyboard: bool,
}

/// An open portal session; closed (bounded) on drop.
pub struct PortalSession {
    runtime: &'static Runtime,
    session: RemoteDesktopSession,
}

impl Drop for PortalSession {
    fn drop(&mut self) {
        self.runtime.block_on(close(&self.session));
    }
}

/// Closes `session`, bounded by [`CLOSE_TIMEOUT`]; a failure is reported,
/// never raised, because it only ever happens on a teardown path.
async fn close(session: &RemoteDesktopSession) {
    match tokio::time::timeout(CLOSE_TIMEOUT, session.close()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("senpi-desktop-backend-wayland: RemoteDesktop Close: {error}"),
        Err(_) => eprintln!("senpi-desktop-backend-wayland: RemoteDesktop Close timed out"),
    }
}

/// The RemoteDesktop portal, when the session bus serves it. ashpd's
/// constructor succeeds even when no portal service exists (it reads a
/// failed `version` lookup as version 1), so the property is read again here
/// and any failure means the portal is not offered.
async fn offered_portal() -> Result<RemoteDesktop<'static>, String> {
    let portal = RemoteDesktop::new().await.map_err(|err| err.to_string())?;
    portal
        .get_property::<u32>("version")
        .await
        .map_err(|err| err.to_string())?;
    Ok(portal)
}

/// Whether the session bus offers the RemoteDesktop portal. Reads the
/// interface version only: no session, no consent dialog, no libei socket.
pub fn is_offered(runtime: &Runtime) -> bool {
    runtime.block_on(async {
        matches!(
            tokio::time::timeout(PROBE_TIMEOUT, offered_portal()).await,
            Ok(Ok(_))
        )
    })
}

/// Opens a RemoteDesktop session for keyboard and pointer and connects to
/// its EIS server.
///
/// # Errors
/// `InputFailed` naming [`INPUT_PATH_REQUIRED`] when the portal is absent;
/// `PermissionDenied` when the user or compositor refuses a step.
pub fn connect(runtime: &'static Runtime) -> CoreResult<(UnixStream, PortalSession, Granted)> {
    let (fd, session, granted) = runtime.block_on(async {
        let portal = offered_portal()
            .await
            .map_err(|err| DesktopError::input_failed(format!("{INPUT_PATH_REQUIRED}: {err}")))?;
        let session = portal
            .create_session()
            .await
            .map_err(|err| DesktopError::permission_denied(format!("RemoteDesktop CreateSession: {err}")))?;
        match start(&portal, &session).await {
            Ok((fd, granted)) => Ok((fd, session, granted)),
            Err(err) => {
                // Inside `block_on` already, so close inline instead of via Drop.
                close(&session).await;
                Err(DesktopError::permission_denied(err))
            }
        }
    })?;
    Ok((UnixStream::from(fd), PortalSession { runtime, session }, granted))
}

async fn start(
    portal: &RemoteDesktop<'static>,
    session: &RemoteDesktopSession,
) -> Result<(std::os::fd::OwnedFd, Granted), String> {
    portal
        .select_devices(
            session,
            DeviceType::Keyboard | DeviceType::Pointer,
            None,
            PersistMode::DoNot,
        )
        .await
        .map_err(|err| format!("RemoteDesktop SelectDevices: {err}"))?;
    let response = portal
        .start(session, None)
        .await
        .map_err(|err| format!("RemoteDesktop Start: {err}"))?
        .response()
        .map_err(|err| format!("RemoteDesktop permission: {err}"))?;
    let devices = response.devices();
    let granted = Granted {
        pointer: devices.contains(DeviceType::Pointer),
        keyboard: devices.contains(DeviceType::Keyboard),
    };
    let fd = portal
        .connect_to_eis(session)
        .await
        .map_err(|err| format!("RemoteDesktop ConnectToEIS: {err}"))?;
    Ok((fd, granted))
}
