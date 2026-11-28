//! The sway IPC client: `i3-ipc` framing over `$SWAYSOCK`, `GET_OUTPUTS`,
//! `GET_TREE`, `RUN_COMMAND` and the event subscription the stop path uses.
//! One round trip is bounded, so a stuck compositor cannot hang input.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow};
use serde::Deserialize;

pub const SWAYSOCK_ENV: &str = "SWAYSOCK";
const MAGIC: &[u8; 6] = b"i3-ipc";
const HEADER: usize = 14;
/// Bound on one IPC round trip, so a stuck compositor cannot hang input.
const IPC_TIMEOUT: Duration = Duration::from_secs(2);
/// A frame that already started gets this many read-timeout wakes to
/// complete before the reader fails it as broken.
const COMPLETION_GRACE: u32 = 3;
/// Bound on one reply; a `get_tree` reply is a few KiB per window.
const REPLY_LIMIT: u64 = 16 * 1024 * 1024;

pub mod message {
    pub const RUN_COMMAND: u32 = 0;
    pub const SUBSCRIBE: u32 = 2;
    pub const GET_OUTPUTS: u32 = 3;
    pub const GET_TREE: u32 = 4;
}

pub mod event {
    /// sway marks event replies with this bit.
    pub const EVENT_BIT: u32 = 0x8000_0000;
    /// Sent whenever a binding executes.
    pub const BINDING: u32 = EVENT_BIT | 0x0000_0005;
}

/// One request/reply exchange with the compositor.
pub trait SwayIpc: Send {
    /// # Errors
    /// Transport, framing or timeout failure of the round trip.
    fn round_trip(&mut self, kind: u32, payload: &[u8]) -> CoreResult<Vec<u8>>;
}

pub struct SwaySocket {
    stream: UnixStream,
    /// The read-timeout wake the stop path set; bounds a started frame too.
    event_timeout: Duration,
}

impl SwaySocket {
    /// # Errors
    /// The socket at `path` cannot be connected or configured.
    pub fn connect(path: &Path) -> CoreResult<Self> {
        let stream = UnixStream::connect(path).map_err(|error| {
            DesktopError::capture_failed(format!("sway IPC {}: {error}", path.display()))
        })?;
        stream
            .set_read_timeout(Some(IPC_TIMEOUT))
            .map_err(|error| {
                DesktopError::capture_failed(format!("sway IPC read timeout: {error}"))
            })?;
        stream
            .set_write_timeout(Some(IPC_TIMEOUT))
            .map_err(|error| {
                DesktopError::capture_failed(format!("sway IPC write timeout: {error}"))
            })?;
        Ok(Self {
            stream,
            event_timeout: IPC_TIMEOUT,
        })
    }

    fn read_exactly(&mut self, len: usize, what: &str) -> CoreResult<Vec<u8>> {
        let mut buffer = vec![0; len];
        self.stream
            .read_exact(&mut buffer)
            .map_err(|error| DesktopError::capture_failed(format!("sway IPC {what}: {error}")))?;
        Ok(buffer)
    }

    /// Wakes the event reader at most `timeout` apart, so the stop path can
    /// beat its heartbeat between binding events; a frame that already
    /// started gets `COMPLETION_GRACE` of these to complete.
    ///
    /// # Errors
    /// `CaptureFailed` when the timeout cannot be applied.
    pub fn set_event_read_timeout(&mut self, timeout: Duration) -> CoreResult<()> {
        self.event_timeout = timeout;
        self.stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| {
                DesktopError::capture_failed(format!("sway IPC event timeout: {error}"))
            })
    }

    /// Reads the next event frame on a subscribed connection; `Ok(None)`
    /// when the read timed out with no bytes (the heartbeat wake). A frame
    /// that already started — a split header, or a header whose payload has
    /// not begun — always completes within the deadline or fails without
    /// consuming the next frame's bytes, so no stop event is lost to a
    /// timeout landing between the header and the payload.
    ///
    /// # Errors
    /// `CaptureFailed` when the framing breaks, the socket died, or a
    /// started frame never completed within the deadline.
    pub fn next_event(&mut self) -> CoreResult<Option<Vec<u8>>> {
        let deadline = std::time::Instant::now() + COMPLETION_GRACE * self.event_timeout;
        let mut header = [0u8; HEADER];
        let (filled, timed_out) = self.fill(&mut header, 0, deadline, true)?;
        if timed_out {
            return Ok(None);
        }
        debug_assert_eq!(filled, HEADER);
        if header[..6] != *MAGIC {
            return Err(DesktopError::capture_failed(
                "sway IPC event lost its i3-ipc magic",
            ));
        }
        let length = u32::from_le_bytes(header[6..10].try_into().expect("four bytes")) as u64;
        if length > REPLY_LIMIT {
            return Err(DesktopError::capture_failed(format!(
                "sway IPC event of {length} bytes is over the {REPLY_LIMIT} byte limit"
            )));
        }
        let mut payload = vec![0u8; length as usize];
        // The frame has started: no heartbeat shortcut exists here, only the
        // completion deadline.
        self.fill(&mut payload, 0, deadline, false)?;
        Ok(Some(payload))
    }

    /// Reads into `buffer` from `filled`. With `idle_wake`, a read timeout
    /// while nothing has arrived reports `Ok((filled, true))` — the
    /// heartbeat wake; without it, a started frame keeps waiting for its
    /// remainder until the deadline.
    fn fill(
        &mut self,
        buffer: &mut [u8],
        mut filled: usize,
        deadline: std::time::Instant,
        idle_wake: bool,
    ) -> CoreResult<(usize, bool)> {
        while filled < buffer.len() {
            if std::time::Instant::now() > deadline {
                return Err(DesktopError::capture_failed(
                    "sway IPC event never completed",
                ));
            }
            match self.stream.read(&mut buffer[filled..]) {
                Ok(0) => {
                    return Err(DesktopError::capture_failed("sway IPC socket closed"));
                }
                Ok(count) => filled += count,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    if idle_wake && filled == 0 {
                        return Ok((filled, true));
                    }
                    // A started frame keeps waiting for its remainder.
                }
                Err(error) => {
                    return Err(DesktopError::capture_failed(format!(
                        "sway IPC event: {error}"
                    )));
                }
            }
        }
        Ok((filled, false))
    }
}

impl SwayIpc for SwaySocket {
    fn round_trip(&mut self, kind: u32, payload: &[u8]) -> CoreResult<Vec<u8>> {
        let mut frame = Vec::with_capacity(HEADER + payload.len());
        frame.extend_from_slice(MAGIC);
        frame.extend_from_slice(&(u32::try_from(payload.len()).unwrap_or(u32::MAX)).to_le_bytes());
        frame.extend_from_slice(&kind.to_le_bytes());
        frame.extend_from_slice(payload);
        self.stream
            .write_all(&frame)
            .and_then(|_| self.stream.flush())
            .map_err(|error| DesktopError::capture_failed(format!("sway IPC write: {error}")))?;
        let header = self.read_exactly(HEADER, "header")?;
        if header[..6] != *MAGIC {
            return Err(DesktopError::capture_failed(
                "sway IPC reply lost its i3-ipc magic",
            ));
        }
        let length = u32::from_le_bytes(header[6..10].try_into().expect("four bytes")) as u64;
        if length > REPLY_LIMIT {
            return Err(DesktopError::capture_failed(format!(
                "sway IPC reply of {length} bytes is over the {REPLY_LIMIT} byte limit"
            )));
        }
        self.read_exactly(length as usize, "reply")
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    /// `0,0 1x1`-style geometry `grim -g` takes.
    #[must_use]
    pub fn grim_geometry(&self) -> String {
        format!("{},{} {}x{}", self.x, self.y, self.width, self.height)
    }
}

/// One entry of the `GET_OUTPUTS` reply; fields beyond these are ignored.
#[derive(Debug, Clone, Deserialize)]
pub struct SwayOutput {
    pub name: String,
    #[serde(default)]
    pub make: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub active: bool,
    /// Present before sway 1.7; newer replies carry `power` instead.
    #[serde(default)]
    pub dpms: Option<bool>,
    #[serde(default)]
    pub power: Option<bool>,
    #[serde(default)]
    pub primary: bool,
    pub rect: Rect,
    #[serde(default)]
    pub scale: Option<f64>,
}

impl SwayOutput {
    fn asleep(&self) -> bool {
        self.dpms.is_some_and(|on| !on) || self.power.is_some_and(|on| !on)
    }

    /// The monitor geometry both logical (sway layout) and in screenshot
    /// pixels (`grim -o` captures the output at its scale).
    #[must_use]
    pub fn display(&self) -> DesktopDisplay {
        let scale = self.scale.unwrap_or(1.0).max(1.0);
        let pixel = |value: i32| {
            let scaled = (f64::from(value) * scale)
                .round()
                .clamp(0.0, f64::from(u32::MAX));
            scaled as u32
        };
        let logical = |value: i32| u32::try_from(value.max(0)).unwrap_or(u32::MAX);
        let label = format!("{} {}", self.make, self.model);
        DesktopDisplay {
            id: self.name.clone(),
            name: if label.trim().is_empty() {
                self.name.clone()
            } else {
                label
            },
            x: self.rect.x,
            y: self.rect.y,
            width: logical(self.rect.width),
            height: logical(self.rect.height),
            scale,
            pixel_x: pixel(self.rect.x),
            pixel_y: pixel(self.rect.y),
            pixel_width: pixel(self.rect.width),
            pixel_height: pixel(self.rect.height),
            is_primary: self.primary,
        }
    }
}

/// EWMH-style properties an XWayland leaf carries.
#[derive(Debug, Clone, Deserialize)]
pub struct WindowProperties {
    #[serde(default)]
    pub class: Option<String>,
    #[serde(default)]
    pub instance: Option<String>,
}

/// One node of the `GET_TREE` reply; the fields the backend reads.
#[derive(Debug, Clone, Deserialize)]
pub struct SwayNode {
    pub id: i64,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub focused: bool,
    #[serde(default)]
    pub pid: Option<i64>,
    pub rect: Rect,
    #[serde(default)]
    pub nodes: Vec<SwayNode>,
    #[serde(default)]
    pub floating_nodes: Vec<SwayNode>,
    /// The X11 window id when the leaf is an XWayland client.
    #[serde(default)]
    pub window: Option<i64>,
    #[serde(default)]
    pub window_properties: Option<WindowProperties>,
}

impl SwayNode {
    fn children(&self) -> impl Iterator<Item = &SwayNode> {
        self.nodes.iter().chain(self.floating_nodes.iter())
    }

    /// A leaf container that owns a window: no child containers, and either
    /// an `app_id` (wlroots client) or an X11 `window` id.
    fn is_window(&self) -> bool {
        self.node_type == "con"
            && self.nodes.is_empty()
            && self.floating_nodes.is_empty()
            && (self.app_id.is_some() || self.window.is_some())
    }

    /// Walks the tree collecting window leaves; `output` is the output name
    /// the subtree lives on, so the focused window names the active output.
    fn collect(
        &self,
        output: Option<&str>,
        windows: &mut Vec<DesktopWindow>,
        active: &mut Option<String>,
    ) {
        if self.focused && self.is_window() {
            *active = active.take().or_else(|| output.map(str::to_owned));
        }
        let own = if self.node_type == "output" {
            self.name.as_deref()
        } else {
            output
        };
        if self.is_window() {
            let app = self
                .app_id
                .clone()
                .or_else(|| {
                    self.window_properties
                        .as_ref()
                        .and_then(|props| props.class.clone())
                })
                .unwrap_or_default();
            windows.push(DesktopWindow {
                id: self.id.to_string(),
                title: self.name.clone().unwrap_or_default(),
                app,
                pid: self.pid.and_then(|pid| u32::try_from(pid).ok()),
                x: self.rect.x,
                y: self.rect.y,
                width: u32::try_from(self.rect.width.max(0)).unwrap_or(u32::MAX),
                height: u32::try_from(self.rect.height.max(0)).unwrap_or(u32::MAX),
                focused: self.focused,
                is_on_screen: Some(true),
                elevated: None,
                identity: None,
            });
        }
        for child in self.children() {
            child.collect(own, windows, active);
        }
    }

    /// Every window leaf, plus the output name holding the focused window.
    #[must_use]
    pub fn windows(&self) -> (Vec<DesktopWindow>, Option<String>) {
        let mut windows = Vec::new();
        let mut active = None;
        self.collect(None, &mut windows, &mut active);
        (windows, active)
    }

    /// The subtree node whose id matches, when it is a window leaf.
    #[must_use]
    pub fn find(&self, id: &str) -> Option<&SwayNode> {
        if self.id.to_string() == id {
            return self.is_window().then_some(self);
        }
        self.children().find_map(|child| child.find(id))
    }
}

/// # Errors
/// `CaptureFailed` when the reply cannot be read or parsed.
pub fn outputs(ipc: &mut dyn SwayIpc) -> CoreResult<Vec<DesktopDisplay>> {
    let reply = ipc.round_trip(message::GET_OUTPUTS, b"")?;
    let outputs: Vec<SwayOutput> = serde_json::from_slice(&reply).map_err(|error| {
        DesktopError::capture_failed(format!("sway GET_OUTPUTS reply: {error}"))
    })?;
    Ok(outputs
        .into_iter()
        .filter(|output| {
            output.active && !output.asleep() && output.rect.width > 0 && output.rect.height > 0
        })
        .map(|output| output.display())
        .collect())
}

/// # Errors
/// `CaptureFailed` when the reply cannot be read or parsed.
pub fn tree(ipc: &mut dyn SwayIpc) -> CoreResult<SwayNode> {
    let reply = ipc.round_trip(message::GET_TREE, b"")?;
    serde_json::from_slice(&reply)
        .map_err(|error| DesktopError::capture_failed(format!("sway GET_TREE reply: {error}")))
}

/// # Errors
/// `CaptureFailed` when the command cannot run or any parsed command fails.
pub fn run_command(ipc: &mut dyn SwayIpc, command: &str) -> CoreResult<()> {
    let reply = ipc.round_trip(message::RUN_COMMAND, command.as_bytes())?;
    let outcomes: Vec<CommandOutcome> = serde_json::from_slice(&reply).map_err(|error| {
        DesktopError::capture_failed(format!("sway RUN_COMMAND reply: {error}"))
    })?;
    outcomes
        .into_iter()
        .find(|outcome| !outcome.success)
        .map(|outcome| {
            DesktopError::capture_failed(format!(
                "sway command '{command}' failed: {}",
                outcome.error.unwrap_or_else(|| "unknown error".to_owned())
            ))
        })
        .map_or(Ok(()), Err)
}

#[derive(Debug, Deserialize)]
struct CommandOutcome {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    error: Option<String>,
}

/// # Errors
/// `CaptureFailed` when the subscription reply cannot be read or is refused.
pub fn subscribe(ipc: &mut dyn SwayIpc, events: &[&str]) -> CoreResult<()> {
    let payload = serde_json::to_vec(events).map_err(|error| {
        DesktopError::capture_failed(format!("sway SUBSCRIBE payload: {error}"))
    })?;
    let reply = ipc.round_trip(message::SUBSCRIBE, &payload)?;
    let outcome: CommandOutcome = serde_json::from_slice(&reply)
        .map_err(|error| DesktopError::capture_failed(format!("sway SUBSCRIBE reply: {error}")))?;
    if outcome.success {
        Ok(())
    } else {
        Err(DesktopError::capture_failed(format!(
            "sway refused to subscribe to {events:?}"
        )))
    }
}
