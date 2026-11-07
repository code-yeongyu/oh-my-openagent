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
}

#[cfg(test)]
pub(crate) mod tests {
    use std::os::unix::net::UnixListener;
    use std::thread::JoinHandle;

    use senpi_desktop_core::error::ErrorCode;

    use super::*;

    /// `hyprctl -j clients` on Hyprland 0.45 (trimmed to four windows):
    /// a tiled terminal and editor on workspace 1, a floating dialog of the
    /// editor, and a window on hidden workspace 3.
    pub const CLIENTS: &str = r#"[
      {"address":"0x5f0c4d0a7d10","mapped":true,"hidden":false,"at":[10,48],"size":[1260,1012],
       "workspace":{"id":1,"name":"1"},"floating":false,"pseudo":false,"monitor":0,"class":"kitty",
       "title":"~","initialClass":"kitty","initialTitle":"kitty","pid":1201,"xwayland":false,
       "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
       "focusHistoryID":1,"inhibitingIdle":false},
      {"address":"0x5f0c4d0b1e20","mapped":true,"hidden":false,"at":[1290,48],"size":[1260,1012],
       "workspace":{"id":1,"name":"1"},"floating":false,"pseudo":false,"monitor":0,"class":"gedit",
       "title":"notes.txt","initialClass":"gedit","initialTitle":"gedit","pid":1302,"xwayland":false,
       "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
       "focusHistoryID":0,"inhibitingIdle":false},
      {"address":"0x5f0c4d0c2f30","mapped":true,"hidden":false,"at":[1500,300],"size":[600,400],
       "workspace":{"id":1,"name":"1"},"floating":true,"pseudo":false,"monitor":0,"class":"gedit",
       "title":"Save As","initialClass":"gedit","initialTitle":"gedit","pid":1302,"xwayland":false,
       "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
       "focusHistoryID":2,"inhibitingIdle":false},
      {"address":"0x5f0c4d0d3a40","mapped":true,"hidden":false,"at":[2570,48],"size":[1000,800],
       "workspace":{"id":3,"name":"3"},"floating":false,"pseudo":false,"monitor":1,"class":"firefox",
       "title":"Docs","initialClass":"firefox","initialTitle":"Firefox","pid":1403,"xwayland":false,
       "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
       "focusHistoryID":3,"inhibitingIdle":false}
    ]"#;

    /// `hyprctl -j monitors`: DP-1 shows workspace 1, HDMI-A-1 workspace 2.
    pub const MONITORS: &str = r#"[
      {"id":0,"name":"DP-1","description":"Dell U2720Q","make":"Dell","model":"U2720Q","serial":"",
       "width":2560,"height":1440,"refreshRate":59.95,"x":0,"y":0,"activeWorkspace":{"id":1,"name":"1"},
       "specialWorkspace":{"id":0,"name":""},"reserved":[0,0,0,0],"scale":1.00,"transform":0,
       "focused":true,"dpmsStatus":true,"vrr":false,"disabled":false,"availableModes":[]},
      {"id":1,"name":"HDMI-A-1","description":"","make":"","model":"","serial":"","width":1920,
       "height":1080,"refreshRate":60.0,"x":2560,"y":0,"activeWorkspace":{"id":2,"name":"2"},
       "specialWorkspace":{"id":0,"name":""},"reserved":[0,0,0,0],"scale":1.00,"transform":0,
       "focused":false,"dpmsStatus":true,"vrr":false,"disabled":false,"availableModes":[]}
    ]"#;

    pub fn window(pid: Option<u32>, title: &str) -> DesktopWindow {
        DesktopWindow {
            id: "atspi::1.31:/org/a11y/atspi/accessible/7".to_owned(),
            title: title.to_owned(),
            app: "app".to_owned(),
            pid,
            x: 0,
            y: 0,
            width: 1260,
            height: 1012,
            focused: false,
            is_on_screen: None,
            elevated: None,
            identity: None,
        }
    }

    fn placed(pid: Option<u32>, title: &str) -> CoreResult<Placement> {
        let clients = parse_clients(CLIENTS).expect("clients parse");
        let monitors = parse_monitors(MONITORS).expect("monitors parse");
        place(&clients, &monitors, &window(pid, title))
    }

    /// Serves `replies` (request -> reply) on a socket at
    /// `<runtime>/hypr/<signature>/.socket.sock`, one request per connection.
    pub fn serve(
        runtime: &Path,
        signature: &str,
        replies: Vec<(&'static str, &'static str)>,
    ) -> JoinHandle<Vec<String>> {
        let dir = runtime.join("hypr").join(signature);
        std::fs::create_dir_all(&dir).expect("hypr dir");
        let listener = UnixListener::bind(dir.join(SOCKET_NAME)).expect("bind hyprland socket");
        std::thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..replies.len() {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut request = String::new();
                stream.read_to_string(&mut request).expect("read request");
                let reply = replies
                    .iter()
                    .find(|(command, _)| *command == request)
                    .map_or("unknown request", |(_, reply)| *reply);
                stream.write_all(reply.as_bytes()).expect("write reply");
                seen.push(request);
            }
            seen
        })
    }

    #[test]
    fn clients_reply_parses_geometry_and_identity() {
        let clients = parse_clients(CLIENTS).expect("clients parse");

        assert_eq!(clients.len(), 4);
        assert_eq!(clients[1].address, "0x5f0c4d0b1e20");
        assert_eq!(clients[1].pid, 1302);
        assert_eq!(
            clients[1].rect(),
            Some(WindowRect {
                x: 1290,
                y: 48,
                width: 1260,
                height: 1012
            })
        );
        assert!(clients[2].floating);
    }

    #[test]
    fn malformed_reply_is_an_internal_error() {
        let error =
            parse_clients("{\"not\":\"an array\"}").expect_err("an object is not a clients reply");
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.starts_with("hyprland clients reply"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_tiled_window_is_placed_by_pid_with_the_floating_dialog_covering_it() {
        let placement = placed(Some(1201), "~").expect("terminal placed");

        assert_eq!(placement.address, "0x5f0c4d0a7d10");
        assert_eq!(
            placement.rect,
            WindowRect {
                x: 10,
                y: 48,
                width: 1260,
                height: 1012
            }
        );
        assert_eq!(
            placement.covering.len(),
            2,
            "the editor and its dialog, not the hidden workspace"
        );
    }

    #[test]
    fn a_shared_pid_is_told_apart_by_title() {
        let dialog = placed(Some(1302), "Save As").expect("dialog placed");

        assert_eq!(dialog.address, "0x5f0c4d0c2f30");
        assert!(
            dialog.covering.is_empty(),
            "tiled windows sit below a floating one"
        );
        assert_eq!(
            placed(Some(1302), "notes.txt")
                .expect("editor placed")
                .covering
                .len(),
            2
        );
    }

    #[test]
    fn unmatched_ambiguous_pidless_and_hidden_windows_are_refused() {
        for (pid, title) in [
            (Some(9999), "~"),
            (Some(1302), "Untitled"),
            (None, "~"),
            (Some(1403), "Docs"),
        ] {
            let error = placed(pid, title).expect_err("must be refused");
            assert_eq!(
                error.code,
                ErrorCode::BackgroundUnavailable,
                "{pid:?} {title}"
            );
            assert!(
                error.message.contains("hyprland-window-unresolved"),
                "{}",
                error.message
            );
        }
    }

    #[test]
    fn detection_follows_the_signature_and_its_socket() {
        let runtime = tempfile::tempdir().expect("runtime dir");
        let dir = || Some(runtime.path().as_os_str().to_owned());

        assert_eq!(detect_from(None, dir()), Detection::NotHyprland);
        assert_eq!(detect_from(Some("".into()), dir()), Detection::NotHyprland);
        assert_eq!(
            detect_from(Some("abc_123".into()), dir()),
            Detection::IpcMissing
        );
        assert_eq!(
            detect_from(Some("../escape".into()), dir()),
            Detection::IpcMissing
        );

        let _server = serve(runtime.path(), "abc_123", Vec::new());
        let socket = runtime.path().join("hypr/abc_123").join(SOCKET_NAME);
        assert_eq!(
            detect_from(Some("abc_123".into()), dir()),
            Detection::Ipc(Hyprland { socket })
        );
    }

    #[test]
    fn placement_reads_clients_and_monitors_over_ipc() {
        let runtime = tempfile::tempdir().expect("runtime dir");
        let server = serve(
            runtime.path(),
            "sig",
            vec![("j/clients", CLIENTS), ("j/monitors", MONITORS)],
        );
        let Detection::Ipc(hyprland) = detect_from(Some("sig".into()), Some(runtime.path().into()))
        else {
            panic!("socket not detected");
        };

        let placement = hyprland
            .placement(&window(Some(1201), "~"))
            .expect("placed over IPC");

        assert_eq!(placement.address, "0x5f0c4d0a7d10");
        assert_eq!(server.join().expect("server"), ["j/clients", "j/monitors"]);
    }
}
