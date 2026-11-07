//! GNOME window geometry from the read-only `senpi-desktop-window-rects`
//! GNOME Shell extension (`crates/senpi-desktop-gnome-extension`), probed
//! only when `XDG_CURRENT_DESKTOP` names GNOME. Mutter offers clients no way
//! to list other windows, so the extension serves one method, `List`, on
//! GNOME Shell's own bus name (`org.gnome.Shell`): the window stack, bottom
//! first, as JSON. It changes nothing: input never goes through the shell,
//! pointer input stays on libei, and this module only says where a target
//! window is and which shown windows are stacked above it.

use std::ffi::OsString;
use std::future::Future;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use serde::Deserialize;
use zbus::Connection;

use super::hyprland::{Placement, WindowRect};
use crate::portal::portal_runtime;

pub const DESKTOP_ENV: &str = "XDG_CURRENT_DESKTOP";
/// The extension runs inside GNOME Shell and exports on the shell's own
/// connection, so only the shell can answer at this name.
pub const SHELL_SERVICE: &str = "org.gnome.Shell";
pub const RECTS_PATH: &str = "/dev/omo/SenpiDesktop/WindowRects";
pub const RECTS_IFACE: &str = "dev.omo.SenpiDesktop.WindowRects";
/// Bound on each bus call, so a stuck shell cannot hang capabilities or input.
const CALL_TIMEOUT: Duration = Duration::from_secs(2);
/// Bound on one reply; an entry is ~150 bytes per window.
const REPLY_LIMIT: usize = 16 * 1024 * 1024;

/// One entry of the extension's reply, in Mutter's stacking order (bottom
/// first).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GnomeWindow {
    /// `Meta.Window.get_stable_sequence()`, as a string.
    pub id: String,
    /// `0` when Mutter does not know the owner.
    pub pid: i64,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// On the active workspace, not minimized and not hidden.
    pub shown: bool,
    /// A desktop-type window (desktop icons), which sits below every window.
    #[serde(default, rename = "desktopWindow")]
    pub desktop_window: bool,
}

impl GnomeWindow {
    fn rect(&self) -> Option<WindowRect> {
        let width = u32::try_from(self.width).ok().filter(|width| *width > 0)?;
        let height = u32::try_from(self.height)
            .ok()
            .filter(|height| *height > 0)?;
        Some(WindowRect {
            x: self.x,
            y: self.y,
            width,
            height,
        })
    }
}

/// # Errors
/// `Internal` when the reply is not the extension's JSON array.
pub fn parse_windows(json: &str) -> CoreResult<Vec<GnomeWindow>> {
    serde_json::from_str(json)
        .map_err(|err| DesktopError::internal(format!("gnome windows reply: {err}")))
}

fn refuse(window: &DesktopWindow, why: &str) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {} gnome-window-unresolved: {why}; no input was sent",
        window.id
    ))
}

/// Matches the AT-SPI `window` to one GNOME window (same pid, and same
/// title when the pid owns several) and lists the shown windows stacked
/// above it.
///
/// # Errors
/// `BackgroundUnavailable` when the window has no pid, matches no GNOME
/// window or more than one, or is minimized, hidden or on another workspace.
pub fn place(windows: &[GnomeWindow], window: &DesktopWindow) -> CoreResult<Placement> {
    let pid = window.pid.ok_or_else(|| {
        refuse(
            window,
            "the accessibility tree reports no pid to match a GNOME window by",
        )
    })?;
    let owned: Vec<(usize, &GnomeWindow)> = windows
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !candidate.desktop_window && candidate.pid == i64::from(pid))
        .collect();
    let candidates: Vec<(usize, &GnomeWindow)> = if owned.len() > 1 {
        owned
            .into_iter()
            .filter(|(_, candidate)| candidate.title == window.title)
            .collect()
    } else {
        owned
    };
    let (stack, target) = match candidates.as_slice() {
        [one] => *one,
        [] => return Err(refuse(window, "no GNOME window matches its pid and title")),
        _ => {
            return Err(refuse(
                window,
                "several GNOME windows share its pid and title",
            ))
        }
    };
    if !target.shown {
        return Err(refuse(
            window,
            "it is minimized, hidden or on another workspace",
        ));
    }
    let rect = target
        .rect()
        .ok_or_else(|| refuse(window, "GNOME reports an empty window size"))?;
    let covering = windows[stack + 1..]
        .iter()
        .filter(|above| above.shown && !above.desktop_window)
        .filter_map(GnomeWindow::rect)
        .collect();
    Ok(Placement {
        address: target.id.clone(),
        rect,
        covering,
    })
}

/// What the environment says about GNOME.
#[derive(Debug, Clone)]
pub enum Detection {
    NotGnome,
    /// A GNOME session whose shell does not serve the window-rect extension
    /// (not installed, disabled, or no session bus).
    ExtensionMissing,
    Extension(Gnome),
}

/// A session-bus connection on which `org.gnome.Shell` serves the
/// window-rect extension.
#[derive(Debug, Clone)]
pub struct Gnome {
    connection: Connection,
}

fn is_gnome(desktop: Option<&OsString>) -> bool {
    desktop
        .and_then(|desktop| desktop.to_str())
        .is_some_and(|desktop| {
            desktop
                .split(':')
                .any(|name| name.eq_ignore_ascii_case("gnome"))
        })
}

async fn offers_rects(connection: &Connection) -> bool {
    let introspect = connection.call_method(
        Some(SHELL_SERVICE),
        RECTS_PATH,
        Some("org.freedesktop.DBus.Introspectable"),
        "Introspect",
        &(),
    );
    match tokio::time::timeout(CALL_TIMEOUT, introspect).await {
        Ok(Ok(reply)) => reply
            .body()
            .deserialize::<String>()
            .is_ok_and(|xml| xml.contains(&format!("\"{RECTS_IFACE}\""))),
        Ok(Err(_)) | Err(_) => false,
    }
}

/// `NotGnome` off GNOME (the bus is never touched); else `Extension` when
/// `connect` reaches a bus whose `org.gnome.Shell` serves the extension.
pub fn detect_with<F>(desktop: Option<OsString>, connect: impl FnOnce() -> F) -> Detection
where
    F: Future<Output = zbus::Result<Connection>>,
{
    if !is_gnome(desktop.as_ref()) {
        return Detection::NotGnome;
    }
    let Ok(runtime) = portal_runtime() else {
        return Detection::ExtensionMissing;
    };
    runtime.block_on(async {
        match tokio::time::timeout(CALL_TIMEOUT, connect()).await {
            Ok(Ok(connection)) if offers_rects(&connection).await => {
                Detection::Extension(Gnome { connection })
            }
            Ok(_) | Err(_) => Detection::ExtensionMissing,
        }
    })
}

/// Reads `XDG_CURRENT_DESKTOP` now and, on GNOME, the session bus.
pub fn detect() -> Detection {
    detect_with(std::env::var_os(DESKTOP_ENV), Connection::session)
}

fn internal(what: &str, err: impl std::fmt::Display) -> DesktopError {
    DesktopError::internal(format!("gnome {what}: {err}"))
}

impl Gnome {
    async fn list(&self) -> CoreResult<String> {
        let call = self.connection.call_method(
            Some(SHELL_SERVICE),
            RECTS_PATH,
            Some(RECTS_IFACE),
            "List",
            &(),
        );
        let reply = match tokio::time::timeout(CALL_TIMEOUT, call).await {
            Ok(reply) => reply.map_err(|err| internal("List", err))?,
            Err(_) => return Err(internal("List", "no reply in time")),
        };
        let json: String = reply
            .body()
            .deserialize()
            .map_err(|err| internal("List reply", err))?;
        if json.len() > REPLY_LIMIT {
            return Err(internal("List reply", "too large"));
        }
        Ok(json)
    }

    /// Every GNOME window in stacking order, read fresh from the shell.
    ///
    /// # Errors
    /// `Internal` when the extension fails or does not answer in time.
    pub fn windows(&self) -> CoreResult<Vec<GnomeWindow>> {
        parse_windows(&portal_runtime()?.block_on(self.list())?)
    }

    /// Where `window` is now, read fresh from the compositor.
    ///
    /// # Errors
    /// See [`place`] and [`Gnome::windows`].
    pub fn placement(&self, window: &DesktopWindow) -> CoreResult<Placement> {
        place(&self.windows()?, window)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use senpi_desktop_core::error::ErrorCode;

    use super::*;
    use crate::compositor::hyprland::tests::window;
    use crate::test_support::fake_gnome::FakeGnome;

    /// What the extension reports on GNOME 47 (stacking order, bottom first):
    /// the desktop icons, a terminal and an editor side by side, the editor's
    /// Save As dialog over it, a minimized window, a window on another
    /// workspace, and an always-on-top picture-in-picture window. The
    /// extension's own test renders this file from fake Mutter windows.
    pub const WINDOWS: &str = include_str!("../../testdata/gnome-windows.json");

    fn placed(pid: Option<u32>, title: &str) -> CoreResult<Placement> {
        place(
            &parse_windows(WINDOWS).expect("windows parse"),
            &window(pid, title),
        )
    }

    #[test]
    fn the_extension_reply_parses_geometry_identity_and_visibility() {
        let windows = parse_windows(WINDOWS).expect("windows parse");

        assert_eq!(windows.len(), 7);
        assert_eq!(windows[2].id, "21");
        assert_eq!(windows[2].pid, 1302);
        assert_eq!(
            windows[2].rect(),
            Some(WindowRect {
                x: 1290,
                y: 48,
                width: 1260,
                height: 1012
            })
        );
        assert!(windows[0].desktop_window);
        assert!(!windows[4].shown);
        assert!(!windows[5].shown);
    }

    #[test]
    fn a_malformed_reply_is_an_internal_error() {
        let error = parse_windows("{\"windows\":[]}").expect_err("an object is not the reply");
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.starts_with("gnome windows reply"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_window_is_placed_by_pid_with_the_shown_windows_above_it_covering() {
        let placement = placed(Some(1201), "~ : bash").expect("terminal placed");

        assert_eq!(placement.address, "17");
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
            3,
            "the editor, its dialog and the picture-in-picture window; not the \
             minimized window, the other workspace or the desktop"
        );
    }

    #[test]
    fn a_shared_pid_is_told_apart_by_title_and_only_higher_windows_cover() {
        let dialog = placed(Some(1302), "Save As").expect("dialog placed");
        let editor = placed(Some(1302), "notes.txt - Text Editor").expect("editor placed");

        assert_eq!(dialog.address, "22");
        assert_eq!(
            dialog.covering.len(),
            1,
            "only the picture-in-picture window"
        );
        assert_eq!(
            editor.covering.len(),
            2,
            "the dialog and the picture-in-picture window"
        );
    }

    #[test]
    fn unmatched_ambiguous_pidless_hidden_and_other_workspace_windows_are_refused() {
        for (pid, title) in [
            (Some(9999), "~ : bash"),
            (Some(1302), "Untitled - Text Editor"),
            (None, "~ : bash"),
            (Some(1403), "Docs - Firefox"),
            (Some(1504), "Settings"),
        ] {
            let error = placed(pid, title).expect_err("must be refused");
            assert_eq!(
                error.code,
                ErrorCode::BackgroundUnavailable,
                "{pid:?} {title}"
            );
            assert!(
                error.message.contains("gnome-window-unresolved"),
                "{}",
                error.message
            );
        }
    }

    #[test]
    fn detection_touches_no_bus_off_gnome() {
        fn no_bus() -> zbus::Result<Connection> {
            panic!("the bus must not be touched off GNOME")
        }
        for desktop in [None, Some("KDE"), Some("sway"), Some("Hyprland"), Some("")] {
            let detection = detect_with(desktop.map(OsString::from), || async { no_bus() });
            assert!(matches!(detection, Detection::NotGnome), "{desktop:?}");
        }
    }

    #[test]
    fn a_gnome_session_without_the_extension_is_extension_missing() {
        let empty = FakeGnome::bus_only();
        let bare_shell = FakeGnome::shell_without_extension();
        let unreachable = detect_with(Some("GNOME".into()), || async {
            Err::<Connection, _>(zbus::Error::Address("no session bus".to_owned()))
        });
        let no_shell = detect_with(Some("ubuntu:GNOME".into()), || empty.connect());
        let no_extension = detect_with(Some("GNOME".into()), || bare_shell.connect());

        assert!(matches!(unreachable, Detection::ExtensionMissing));
        assert!(matches!(no_shell, Detection::ExtensionMissing));
        assert!(matches!(no_extension, Detection::ExtensionMissing));
    }

    #[test]
    fn placement_reads_the_window_list_fresh_on_every_call() {
        // Given: a fake shell whose extension answers with WINDOWS
        let shell = FakeGnome::serve(WINDOWS);
        let Detection::Extension(gnome) = detect_with(Some("GNOME".into()), || shell.connect())
        else {
            panic!("gnome extension not detected");
        };

        // When
        let first = gnome
            .placement(&window(Some(1201), "~ : bash"))
            .expect("placed over D-Bus");
        let second = gnome
            .placement(&window(Some(1302), "Save As"))
            .expect("placed over D-Bus");

        // Then: one List call per placement
        assert_eq!(first.address, "17");
        assert_eq!(second.address, "22");
        assert_eq!(shell.list_calls(), 2);
    }

    #[test]
    fn a_reply_that_is_not_the_window_array_is_refused() {
        let shell = FakeGnome::serve("not json");
        let Detection::Extension(gnome) = detect_with(Some("GNOME".into()), || shell.connect())
        else {
            panic!("gnome extension not detected");
        };

        let error = gnome
            .placement(&window(Some(1201), "~ : bash"))
            .expect_err("garbage must not place");

        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.starts_with("gnome windows reply"),
            "{}",
            error.message
        );
    }
}
