//! The `org.freedesktop.portal.ScreenCast` session that hands out the
//! monitor PipeWire nodes (oh-my-pi `open_screencast`). Never persisted: each
//! engine session asks the compositor again, as the RemoteDesktop portal does.

use std::os::fd::{AsFd, OwnedFd};

use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
use ashpd::desktop::{PersistMode, ResponseError};
use ashpd::Error as PortalError;
use tokio::runtime::Runtime;

use crate::portal::runtime::CLOSE_TIMEOUT;

/// One monitor stream: its node and its place in the logical desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorStream {
    pub node: u32,
    pub position: (i32, i32),
    pub size: Option<(i32, i32)>,
}

pub struct Cast {
    pub monitors: Vec<MonitorStream>,
    remote: OwnedFd,
}

impl Cast {
    /// A fresh fd per PipeWire connection; the portal's fd is kept for the next.
    pub fn remote(&self) -> std::io::Result<OwnedFd> {
        self.remote.as_fd().try_clone_to_owned()
    }
}

/// `(refused, message)`: only the user's Cancelled is a refusal.
type Failure = (bool, String);

fn failed(message: String) -> Failure {
    (false, message)
}

async fn open() -> Result<Cast, Failure> {
    let portal = Screencast::new()
        .await
        .map_err(|error| failed(format!("ScreenCast portal: {error}")))?;
    let session = portal
        .create_session()
        .await
        .map_err(|error| failed(format!("ScreenCast CreateSession: {error}")))?;
    let outcome = async {
        portal
            .select_sources(
                &session,
                CursorMode::Embedded,
                SourceType::Monitor.into(),
                true,
                None,
                PersistMode::DoNot,
            )
            .await
            .map_err(|error| failed(format!("ScreenCast SelectSources: {error}")))?;
        let streams = portal
            .start(&session, None)
            .await
            .map_err(|error| failed(format!("ScreenCast Start: {error}")))?
            .response()
            .map_err(|error| {
                let refused = matches!(error, PortalError::Response(ResponseError::Cancelled));
                (refused, format!("ScreenCast Start: {error}"))
            })?;
        let monitors: Vec<MonitorStream> = streams
            .streams()
            .iter()
            .map(|stream| MonitorStream {
                node: stream.pipe_wire_node_id(),
                position: stream.position().unwrap_or((0, 0)),
                size: stream.size(),
            })
            .collect();
        if monitors.is_empty() {
            return Err(failed("ScreenCast returned no monitor stream".to_owned()));
        }
        let remote = portal
            .open_pipe_wire_remote(&session)
            .await
            .map_err(|error| failed(format!("ScreenCast OpenPipeWireRemote: {error}")))?;
        Ok(Cast { monitors, remote })
    }
    .await;
    if outcome.is_err() {
        if let Ok(Err(error)) = tokio::time::timeout(CLOSE_TIMEOUT, session.close()).await {
            eprintln!("senpi-desktop-backend-wayland: ScreenCast Close: {error}");
        }
    }
    outcome
}

pub fn start(runtime: &Runtime) -> Result<Cast, Failure> {
    runtime.block_on(open())
}
