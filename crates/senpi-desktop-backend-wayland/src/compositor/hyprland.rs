//! Hyprland window geometry over its IPC socket (the JSON `clients` and
//! `monitors` replies `hyprctl -j` prints), read only when
//! `HYPRLAND_INSTANCE_SIGNATURE` names an instance. Input never goes through
//! Hyprland: pointer input stays on libei, and this module only says where a
//! target window is and which visible windows could sit above it.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use serde::Deserialize;

pub const SIGNATURE_ENV: &str = "HYPRLAND_INSTANCE_SIGNATURE";
const SOCKET_NAME: &str = ".socket.sock";
/// Hyprland before 0.40 kept its sockets under `/tmp/hypr`.
const LEGACY_DIR: &str = "/tmp/hypr";
/// Bound on one IPC round trip, so a stuck compositor cannot hang input.
const IPC_TIMEOUT: Duration = Duration::from_secs(2);
/// Bound on one reply; a `clients` reply is a few KiB per window.
const REPLY_LIMIT: u64 = 16 * 1024 * 1024;

/// A window rectangle in the compositor's logical layout coordinates, the
/// space libei absolute-pointer regions use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowRect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        let left = f64::from(self.x);
        let top = f64::from(self.y);
        x >= left
            && y >= top
            && x < left + f64::from(self.width)
            && y < top + f64::from(self.height)
    }
}

/// Where a target window is and what may cover it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub address: String,
    pub rect: WindowRect,
    /// Rectangles of visible windows that may be stacked above the target.
    pub covering: Vec<WindowRect>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct WorkspaceRef {
    id: i64,
}

/// One entry of the `clients` reply; fields beyond these are ignored.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Client {
    pub address: String,
    pub mapped: bool,
    pub hidden: bool,
    pub at: [i32; 2],
    pub size: [i32; 2],
    workspace: WorkspaceRef,
    pub floating: bool,
    #[serde(default)]
    pub pinned: bool,
    pub title: String,
    /// `-1` when Hyprland does not know the owner.
    pub pid: i64,
}

impl Client {
    fn rect(&self) -> Option<WindowRect> {
        let width = u32::try_from(self.size[0])
            .ok()
            .filter(|width| *width > 0)?;
        let height = u32::try_from(self.size[1])
            .ok()
            .filter(|height| *height > 0)?;
        Some(WindowRect {
            x: self.at[0],
            y: self.at[1],
            width,
            height,
        })
    }
}

/// One entry of the `monitors` reply; only the workspaces it shows.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Monitor {
    #[serde(rename = "activeWorkspace")]
    active_workspace: WorkspaceRef,
    #[serde(rename = "specialWorkspace", default)]
    special_workspace: Option<WorkspaceRef>,
    #[serde(default)]
    disabled: bool,
}

/// # Errors
/// `Internal` when the reply is not a `clients` JSON array.
pub fn parse_clients(json: &str) -> CoreResult<Vec<Client>> {
    serde_json::from_str(json)
        .map_err(|err| DesktopError::internal(format!("hyprland clients reply: {err}")))
}

/// # Errors
/// `Internal` when the reply is not a `monitors` JSON array.
pub fn parse_monitors(json: &str) -> CoreResult<Vec<Monitor>> {
    serde_json::from_str(json)
        .map_err(|err| DesktopError::internal(format!("hyprland monitors reply: {err}")))
}

/// Workspaces some enabled monitor shows now (id 0 is "no special workspace").
fn visible_workspaces(monitors: &[Monitor]) -> HashSet<i64> {
    monitors
        .iter()
        .filter(|monitor| !monitor.disabled)
        .flat_map(|monitor| {
            [
                Some(&monitor.active_workspace),
                monitor.special_workspace.as_ref(),
            ]
        })
        .flatten()
        .map(|workspace| workspace.id)
        .filter(|id| *id != 0)
        .collect()
}

fn refuse(window: &DesktopWindow, why: &str) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {} hyprland-window-unresolved: {why}; no input was sent",
        window.id
    ))
}

/// Matches the AT-SPI `window` to one shown Hyprland client (same pid, and
/// same title when the pid owns several) and lists the shown windows that may
/// be stacked above it: every other one for a tiled target, the floating and
/// pinned ones for a floating target (Hyprland stacks floating over tiled).
///
/// The covering list holds only the `clients` reply's toplevel windows.
/// Layer-shell surfaces (bars, notifications, lock screens and other
/// overlays, which `hyprctl -j layers` lists) are not in it, so a point under
/// one of them is not refused here.
///
/// # Errors
/// `BackgroundUnavailable` when the window has no pid, matches no shown
/// client or more than one, or is not on a workspace a monitor shows.
pub fn place(
    clients: &[Client],
    monitors: &[Monitor],
    window: &DesktopWindow,
) -> CoreResult<Placement> {
    let pid = window.pid.ok_or_else(|| {
        refuse(
            window,
            "the accessibility tree reports no pid to match a Hyprland client by",
        )
    })?;
    let visible = visible_workspaces(monitors);
    let shown = |client: &&Client| {
        client.mapped && !client.hidden && (client.pinned || visible.contains(&client.workspace.id))
    };
    let owned: Vec<&Client> = clients
        .iter()
        .filter(|client| client.mapped && !client.hidden && client.pid == i64::from(pid))
        .collect();
    let candidates: Vec<&Client> = if owned.len() > 1 {
        owned
            .into_iter()
            .filter(|client| client.title == window.title)
            .collect()
    } else {
        owned
    };
    let target = match candidates.as_slice() {
        [one] => *one,
        [] => {
            return Err(refuse(
                window,
                "no mapped Hyprland client matches its pid and title",
            ))
        }
        _ => {
            return Err(refuse(
                window,
                "several Hyprland clients share its pid and title",
            ))
        }
    };
    if !shown(&target) {
        return Err(refuse(window, "it is not on a workspace any monitor shows"));
    }
    let rect = target
        .rect()
        .ok_or_else(|| refuse(window, "Hyprland reports an empty window size"))?;
    let covering = clients
        .iter()
        .filter(shown)
        .filter(|client| client.address != target.address)
        .filter(|client| !target.floating || client.floating || client.pinned)
        .filter_map(Client::rect)
        .collect();
    Ok(Placement {
        address: target.address.clone(),
        rect,
        covering,
    })
}

/// What the environment says about Hyprland.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detection {
    NotHyprland,
    /// The signature is set, but no IPC socket exists for it.
    IpcMissing,
    Ipc(Hyprland),
}

/// The IPC socket of one Hyprland instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hyprland {
    socket: PathBuf,
}

fn is_socket(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.file_type().is_socket())
}

/// Resolves the instance socket: `$XDG_RUNTIME_DIR/hypr/<sig>/.socket.sock`,
/// else the pre-0.40 `/tmp/hypr/<sig>/.socket.sock`. A signature that is not
/// a single path component never resolves.
pub fn detect_from(signature: Option<OsString>, runtime_dir: Option<OsString>) -> Detection {
    let Some(signature) = signature.filter(|signature| !signature.is_empty()) else {
        return Detection::NotHyprland;
    };
    let single_component = Path::new(&signature)
        .components()
        .eq([std::path::Component::Normal(signature.as_os_str())]);
    if !single_component {
        return Detection::IpcMissing;
    }
    runtime_dir
        .map(|dir| PathBuf::from(dir).join("hypr"))
        .into_iter()
        .chain([PathBuf::from(LEGACY_DIR)])
        .map(|dir| dir.join(&signature).join(SOCKET_NAME))
        .find(|socket| is_socket(socket))
        .map_or(Detection::IpcMissing, |socket| {
            Detection::Ipc(Hyprland { socket })
        })
}

/// Reads `HYPRLAND_INSTANCE_SIGNATURE` and `XDG_RUNTIME_DIR` now.
pub fn detect() -> Detection {
    detect_from(
        std::env::var_os(SIGNATURE_ENV),
        std::env::var_os("XDG_RUNTIME_DIR"),
    )
}

impl Hyprland {
    /// One JSON request (`j/<command>`) and its whole reply.
    ///
    /// # Errors
    /// `Internal` when the socket cannot be reached or the reply is not UTF-8.
    pub fn request(&self, command: &str) -> CoreResult<String> {
        let ipc =
            |err: std::io::Error| DesktopError::internal(format!("hyprland IPC {command}: {err}"));
        let mut stream = UnixStream::connect(&self.socket).map_err(ipc)?;
        stream.set_read_timeout(Some(IPC_TIMEOUT)).map_err(ipc)?;
        stream.set_write_timeout(Some(IPC_TIMEOUT)).map_err(ipc)?;
        stream
            .write_all(format!("j/{command}").as_bytes())
            .map_err(ipc)?;
        stream.shutdown(std::net::Shutdown::Write).map_err(ipc)?;
        let mut reply = String::new();
        stream
            .take(REPLY_LIMIT)
            .read_to_string(&mut reply)
            .map_err(ipc)?;
        Ok(reply)
    }

    /// Where `window` is now, read fresh from the compositor.
    ///
    /// # Errors
    /// See [`place`] and [`Hyprland::request`].
    pub fn placement(&self, window: &DesktopWindow) -> CoreResult<Placement> {
        let clients = parse_clients(&self.request("clients")?)?;
        let monitors = parse_monitors(&self.request("monitors")?)?;
        place(&clients, &monitors, window)
    }

    /// `windows` with window `id` moved onto its Hyprland rect, read with one
    /// `clients` and one `monitors` request, so a window capture crops the
    /// pixels Hyprland shows at the same rect a window click is placed at.
    /// When the window cannot be placed, `windows` comes back unchanged with
    /// the refusal saying why; a window `windows` does not list is left to
    /// the caller's own not-found error.
    pub fn place_in(
        &self,
        windows: Vec<DesktopWindow>,
        id: &str,
    ) -> (Vec<DesktopWindow>, Option<DesktopError>) {
        place_window_in(windows, id, |window| self.placement(window))
    }
}

/// `windows` with window `id` moved onto the rect `placement` reports; when
/// it cannot be placed, `windows` comes back unchanged with the refusal, and
/// a window `windows` does not list is left to the caller's not-found error.
pub(crate) fn place_window_in(
    mut windows: Vec<DesktopWindow>,
    id: &str,
    placement: impl FnOnce(&DesktopWindow) -> CoreResult<Placement>,
) -> (Vec<DesktopWindow>, Option<DesktopError>) {
    let Some(window) = windows.iter_mut().find(|window| window.id == id) else {
        return (windows, None);
    };
    let unplaced = match placement(window) {
        Ok(placement) => {
            window.x = placement.rect.x;
            window.y = placement.rect.y;
            window.width = placement.rect.width;
            window.height = placement.rect.height;
            None
        }
        Err(error) => Some(error),
    };
    (windows, unplaced)
}

#[cfg(test)]
pub(crate) mod tests;
