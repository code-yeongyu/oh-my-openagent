//! The live xdg-desktop-portal RemoteDesktop session, through `ashpd`, driven to completion on a
//! private single-thread runtime so the backend stays synchronous.

use std::os::fd::OwnedFd;

use ashpd::desktop::remote_desktop::{DeviceType, RemoteDesktop as Proxy};
use ashpd::desktop::{PersistMode, Session};

use super::{PortalError, RemoteDesktop, SessionHandle, Started};

/// One engine's connection to the portal.
pub struct LivePortal {
    runtime: tokio::runtime::Runtime,
    proxy: Option<Proxy<'static>>,
    session: Option<(SessionHandle, Session<'static, Proxy<'static>>)>,
    started: u32,
}

fn failed(error: &ashpd::Error) -> PortalError {
    match error {
        ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled) => PortalError::Cancelled,
        ashpd::Error::Portal(ashpd::PortalError::Failed(message)) => {
            PortalError::Refused(message.clone())
        }
        other => PortalError::Unavailable(other.to_string()),
    }
}

impl LivePortal {
    /// A portal client; nothing is asked of the portal until [`RemoteDesktop::start`].
    ///
    /// # Errors
    /// The runtime could not be built.
    pub fn new() -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        Ok(Self {
            runtime,
            proxy: None,
            session: None,
            started: 0,
        })
    }

    fn ensure_proxy(&mut self) -> Result<(), PortalError> {
        if self.proxy.is_none() {
            self.proxy = Some(
                self.runtime
                    .block_on(Proxy::new())
                    .map_err(|error| failed(&error))?,
            );
        }
        Ok(())
    }
}

impl RemoteDesktop for LivePortal {
    fn start(
        &mut self,
        restore_token: Option<&str>,
        persist: bool,
        _clipboard: bool,
    ) -> Result<Started, PortalError> {
        self.ensure_proxy()?;
        let proxy = self
            .proxy
            .as_ref()
            .ok_or_else(|| PortalError::Unavailable("no portal".to_owned()))?;
        let persist_mode = if persist {
            PersistMode::ExplicitlyRevoked
        } else {
            PersistMode::DoNot
        };
        let (session, selected) = self
            .runtime
            .block_on(async {
                let session = proxy.create_session().await?;
                proxy
                    .select_devices(
                        &session,
                        DeviceType::Keyboard | DeviceType::Pointer,
                        restore_token,
                        persist_mode,
                    )
                    .await?
                    .response()?;
                let selected = proxy.start(&session, None).await?.response()?;
                Ok::<_, ashpd::Error>((session, selected))
            })
            .map_err(|error| failed(&error))?;
        self.started += 1;
        let handle = SessionHandle(format!("live-{}", self.started));
        let restore_token = selected.restore_token().map(str::to_owned);
        self.session = Some((handle.clone(), session));
        // The portal Clipboard's selection transfer is not driven yet: the rung is not claimed.
        Ok(Started {
            session: handle,
            restore_token,
            clipboard: false,
        })
    }

    fn connect_to_eis(&mut self, session: &SessionHandle) -> Result<OwnedFd, PortalError> {
        self.ensure_proxy()?;
        let proxy = self
            .proxy
            .as_ref()
            .ok_or_else(|| PortalError::Unavailable("no portal".to_owned()))?;
        let Some((handle, live)) = &self.session else {
            return Err(PortalError::Refused("no session".to_owned()));
        };
        if handle != session {
            return Err(PortalError::Refused("not the live session".to_owned()));
        }
        self.runtime
            .block_on(proxy.connect_to_eis(live))
            .map_err(|error| failed(&error))
    }

    /// A closed session answers the next `ConnectToEIS` with a failure, which the reconnect
    /// treats as session loss; this read has no non-blocking form here and answers open.
    fn closed(&mut self, _session: &SessionHandle) -> bool {
        false
    }

    /// `None` until the selection transfer is driven (DEFERRED-LEGS row 51 owed leg).
    fn clipboard_version(&mut self) -> Option<u32> {
        None
    }

    fn clipboard_write(
        &mut self,
        _session: &SessionHandle,
        _text: &str,
    ) -> Result<(), PortalError> {
        Err(PortalError::Unavailable(
            "portal clipboard not driven".to_owned(),
        ))
    }

    fn clipboard_read(&mut self, _session: &SessionHandle) -> Result<String, PortalError> {
        Err(PortalError::Unavailable(
            "portal clipboard not driven".to_owned(),
        ))
    }
}
