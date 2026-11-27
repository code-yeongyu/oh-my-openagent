//! Row 49: the toolkit of a window's client, read from evidence - the libraries its process maps
//! (`/proc/<pid>/maps`), the command lines of its children and the binary its `exe` link names -
//! never from a `WM_CLASS` substring, which any client can choose. `WM_CLASS` is a tiebreaker
//! only: an exact key of row 27's route table classes a client the evidence leaves unknown.
//!
//! The toolkit decides the background (`XSendEvent`) route (d-linux.md 'XSendEvent background
//! rules and the refusal list'): GTK 3/4, Qt on xcb without the shim, LibreOffice VCL, Firefox,
//! Chromium and Electron drop events with the `send_event` flag, xterm drops them unless a
//! resource no other client can read is on, and nothing is known about an unknown client. Each is
//! refused `BackgroundUnavailable` with the toolkit named and nothing sent; only Xt/Motif and Tk
//! clients (and Qt with the shim loaded) take the route.

use std::path::Path;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::routes::{RouteOs, RouteTable};
use omo_computer_core::settings::ToolkitClass;
use serde_json::json;

/// The shared object whose presence in a Qt-xcb client means it accepts synthetic events.
pub const QT_SHIM: &str = "libomo-qt-synthetic";

/// A client toolkit as the evidence shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toolkit {
    Gtk3,
    Gtk4,
    QtXcb { shim: bool },
    Chromium,
    Electron,
    Firefox,
    Vcl,
    Xt,
    Tk,
    Xterm,
    Unknown,
}

impl Toolkit {
    /// The name a refusal's `data.toolkit` carries.
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Gtk3 => "gtk3",
            Self::Gtk4 => "gtk4",
            Self::QtXcb { .. } => "qt_xcb",
            Self::Chromium => "chromium",
            Self::Electron => "electron",
            Self::Firefox => "firefox",
            Self::Vcl => "vcl",
            Self::Xt => "xt",
            Self::Tk => "tk",
            Self::Xterm => "xterm",
            Self::Unknown => "unknown",
        }
    }
}

/// What the backend read about one window's client.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Evidence {
    /// The class part of `WM_CLASS` (the second string), the route table's key.
    pub wm_class: String,
    /// File names of the shared objects the process maps (`libgtk-3.so.0`).
    pub maps: Vec<String>,
    /// The full argv of each child process (Chromium's helpers carry `--type=`).
    pub children: Vec<Vec<String>>,
    /// What `/proc/<pid>/exe` resolves to.
    pub exe: Option<String>,
    /// `resources/app.asar` lies beside the executable: an Electron app.
    pub asar_beside_exe: bool,
}

/// The toolkit the evidence names.
#[must_use]
pub fn classify(evidence: &Evidence) -> Toolkit {
    let maps = |prefix: &str| evidence.maps.iter().any(|name| name.starts_with(prefix));
    let helpers = evidence
        .children
        .iter()
        .flatten()
        .any(|arg| arg.starts_with("--type="));
    let exe_name = evidence
        .exe
        .as_deref()
        .and_then(|exe| exe.rsplit('/').next())
        .unwrap_or_default();
    if helpers {
        return if evidence.asar_beside_exe || exe_name == "electron" {
            Toolkit::Electron
        } else {
            Toolkit::Chromium
        };
    }
    if maps("libqxcb") || (maps("libQt5XcbQpa") || maps("libQt6XcbQpa")) {
        return Toolkit::QtXcb {
            shim: maps(QT_SHIM),
        };
    }
    if maps("libgtk-4.so") {
        Toolkit::Gtk4
    } else if maps("libgtk-3.so") {
        Toolkit::Gtk3
    } else if maps("libxul.so") {
        Toolkit::Firefox
    } else if maps("libvcl") || maps("libmergedlo.so") {
        Toolkit::Vcl
    } else if exe_name == "xterm" || exe_name == "uxterm" {
        Toolkit::Xterm
    } else if maps("libXt.so") || maps("libXm.so") {
        Toolkit::Xt
    } else if maps("libtk8") || maps("libtk9") {
        Toolkit::Tk
    } else {
        Toolkit::Unknown
    }
}

/// The route class row 27's table keys on: the evidence's own, else the exact `WM_CLASS` key.
#[must_use]
pub fn route_class(toolkit: Toolkit, wm_class: &str, table: &RouteTable) -> Option<ToolkitClass> {
    match toolkit {
        Toolkit::QtXcb { .. } => Some(ToolkitClass::QtXcb),
        Toolkit::Chromium | Toolkit::Electron => Some(ToolkitClass::ChromiumElectron),
        Toolkit::Unknown => table.class_of(RouteOs::X11, wm_class),
        _ => None,
    }
}

/// Whether background input may go to a client of `toolkit` (with its route class).
///
/// # Errors
/// `BackgroundUnavailable` with `data.toolkit` naming the toolkit, nothing sent: `chromium_electron`,
/// `canvas_gl` or `pointer_hw` when the class names one, else `toolkit`.
pub fn background_route(toolkit: Toolkit, class: Option<ToolkitClass>) -> Result<(), Refusal> {
    let reason = match (toolkit, class) {
        (Toolkit::Xt | Toolkit::Tk | Toolkit::QtXcb { shim: true }, _) => return Ok(()),
        (_, Some(ToolkitClass::ChromiumElectron)) => Reason::ChromiumElectron,
        (_, Some(ToolkitClass::CanvasGl)) => Reason::CanvasGl,
        (_, Some(ToolkitClass::PointerHw)) => Reason::PointerHw,
        (_, Some(ToolkitClass::QtXcb) | None) => Reason::Toolkit,
    };
    Err(Refusal::new(EngineCode::BackgroundUnavailable, reason)
        .with_data(json!({ "toolkit": toolkit.wire() })))
}

/// Reads the evidence of process `pid` under `proc_root` (`/proc` outside tests); `None` when
/// its maps cannot be read (it exited, or belongs to another user).
#[must_use]
pub fn read_evidence(proc_root: &Path, pid: u32, wm_class: String) -> Option<Evidence> {
    let dir = proc_root.join(pid.to_string());
    let maps = std::fs::read_to_string(dir.join("maps")).ok()?;
    let mut names: Vec<String> = maps
        .lines()
        .filter_map(|line| line.split_whitespace().nth(5))
        .filter_map(|path| path.rsplit('/').next())
        .filter(|name| name.contains(".so"))
        .map(str::to_owned)
        .collect();
    names.sort_unstable();
    names.dedup();
    let exe = std::fs::read_link(dir.join("exe")).ok();
    let asar_beside_exe = exe
        .as_deref()
        .and_then(Path::parent)
        .is_some_and(|dir| dir.join("resources/app.asar").exists());
    let children = child_pids(&dir)
        .iter()
        .filter_map(|child| argv(&proc_root.join(child).join("cmdline")))
        .collect();
    Some(Evidence {
        wm_class,
        maps: names,
        children,
        exe: exe.map(|path| {
            path.to_string_lossy()
                .trim_end_matches(" (deleted)")
                .to_owned()
        }),
        asar_beside_exe,
    })
}

fn argv(path: &Path) -> Option<Vec<String>> {
    let raw = std::fs::read(path).ok()?;
    Some(
        raw.split(|byte| *byte == 0)
            .filter(|arg| !arg.is_empty())
            .map(|arg| String::from_utf8_lossy(arg).into_owned())
            .collect(),
    )
}

/// The child pids every thread of the process lists in `task/*/children`.
fn child_pids(dir: &Path) -> Vec<String> {
    let Ok(tasks) = std::fs::read_dir(dir.join("task")) else {
        return Vec::new();
    };
    tasks
        .filter_map(Result::ok)
        .filter_map(|task| std::fs::read_to_string(task.path().join("children")).ok())
        .flat_map(|list| {
            list.split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
#[path = "toolkit_tests.rs"]
mod tests;
