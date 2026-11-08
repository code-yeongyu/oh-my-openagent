//! GNOME window geometry from the read-only `senpi-desktop-window-rects`
//! GNOME Shell extension (`packages/gnome-window-rects-extension`), probed
//! only when `XDG_CURRENT_DESKTOP` names GNOME. Mutter offers clients no way
//! to list other windows, so the extension serves one method, `List`, on
//! GNOME Shell's own bus name (`org.gnome.Shell`), as JSON: the shell's own
//! state (overview, modal, lock screen), the shell chrome that takes pointer
//! input above windows, and the window stack, bottom first. GNOME Shell's UI is
//! Clutter actors rather than Mutter windows, so without the first two a click
//! "at a window" could land on the overview, a dialog or a banner. It changes
//! nothing: input never goes through the shell, pointer input stays on libei,
//! and this module only says where a target window is and what covers it.

use std::ffi::OsString;
use std::future::Future;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use serde::Deserialize;
use zbus::Connection;

use super::hyprland::{place_window_in, Placement, WindowRect};
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
        nonempty_rect(self.x, self.y, self.width, self.height)
    }
}

fn nonempty_rect(x: i32, y: i32, width: i32, height: i32) -> Option<WindowRect> {
    let width = u32::try_from(width).ok().filter(|width| *width > 0)?;
    let height = u32::try_from(height).ok().filter(|height| *height > 0)?;
    Some(WindowRect {
        x,
        y,
        width,
        height,
    })
}

/// GNOME Shell's own UI that sits over every window.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct ShellState {
    /// The Activities overview (and its app grid) is open.
    pub overview: bool,
    /// A shell modal holds input: a polkit or end-session dialog, a panel menu.
    pub modal: bool,
    /// The lock screen is up.
    pub locked: bool,
}

impl ShellState {
    /// Why no window can take input now, if shell UI is over all of them.
    fn over_every_window(self) -> Option<&'static str> {
        if self.locked {
            Some("the GNOME lock screen is over every window")
        } else if self.overview {
            Some("the GNOME Activities overview is open over every window")
        } else if self.modal {
            Some("a GNOME Shell modal dialog or menu holds the input")
        } else {
            None
        }
    }
}

/// Shell chrome that takes pointer input above windows (the top bar, a
/// notification banner), in stage coordinates.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct ChromeRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The extension's whole `List` reply.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GnomeStack {
    pub shell: ShellState,
    pub chrome: Vec<ChromeRect>,
    /// Mutter's stacking order, bottom first.
    pub windows: Vec<GnomeWindow>,
}

/// # Errors
/// `Internal` when the reply is not the extension's JSON object, including
/// the bare window array of an older extension that reports no shell state.
pub fn parse_stack(json: &str) -> CoreResult<GnomeStack> {
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
/// title when the pid owns several) and lists what covers it: the shown
/// windows stacked above it and the shell chrome that takes input.
///
/// # Errors
/// `BackgroundUnavailable` when the overview, a shell modal or the lock
/// screen is over every window, or the window has no pid, matches no GNOME
/// window or more than one, or is minimized, hidden or on another workspace.
pub fn place(stack: &GnomeStack, window: &DesktopWindow) -> CoreResult<Placement> {
    if let Some(why) = stack.shell.over_every_window() {
        return Err(refuse(window, why));
    }
    let windows = stack.windows.as_slice();
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
    let (index, target) = match candidates.as_slice() {
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
    let covering =
        windows[index + 1..]
            .iter()
            .filter(|above| above.shown && !above.desktop_window)
            .filter_map(GnomeWindow::rect)
            .chain(stack.chrome.iter().filter_map(|chrome| {
                nonempty_rect(chrome.x, chrome.y, chrome.width, chrome.height)
            }))
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

    /// The shell state, its chrome and every GNOME window in stacking order,
    /// read fresh from the shell.
    ///
    /// # Errors
    /// `Internal` when the extension fails or does not answer in time.
    pub fn stack(&self) -> CoreResult<GnomeStack> {
        parse_stack(&portal_runtime()?.block_on(self.list())?)
    }

    /// Where `window` is now, read fresh from the compositor.
    ///
    /// # Errors
    /// See [`place`] and [`Gnome::stack`].
    pub fn placement(&self, window: &DesktopWindow) -> CoreResult<Placement> {
        place(&self.stack()?, window)
    }

    /// `windows` with window `id` moved onto its GNOME frame rect, read with
    /// one extension call, so a window capture crops the pixels GNOME shows at
    /// the same rect a window click is placed at. When the window cannot be
    /// placed, `windows` comes back unchanged with the refusal saying why.
    pub fn place_in(
        &self,
        windows: Vec<DesktopWindow>,
        id: &str,
    ) -> (Vec<DesktopWindow>, Option<DesktopError>) {
        place_window_in(windows, id, |window| self.placement(window))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use senpi_desktop_core::error::ErrorCode;

    use super::*;
    use crate::compositor::hyprland::tests::window;
    use crate::test_support::fake_gnome::FakeGnome;

    /// What the extension reports on GNOME 47: the shell idle with its top bar
    /// taking input, and the windows (stacking order, bottom first): the
    /// desktop icons, a terminal and an editor side by side, the editor's
    /// Save As dialog over it, a minimized window, a window on another
    /// workspace, and an always-on-top picture-in-picture window. The
    /// extension's own test renders this file from fake Mutter windows.
    pub const WINDOWS: &str = include_str!("../../testdata/gnome-windows.json");

    fn placed(pid: Option<u32>, title: &str) -> CoreResult<Placement> {
        place(
            &parse_stack(WINDOWS).expect("windows parse"),
            &window(pid, title),
        )
    }

    #[test]
    fn the_extension_reply_parses_shell_state_chrome_geometry_identity_and_visibility() {
        let stack = parse_stack(WINDOWS).expect("windows parse");
        let windows = &stack.windows;

        assert_eq!(
            stack.shell,
            ShellState {
                overview: false,
                modal: false,
                locked: false
            }
        );
        assert_eq!(
            stack.chrome,
            vec![ChromeRect {
                x: 0,
                y: 0,
                width: 2560,
                height: 32
            }]
        );

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
        // an object without shell state, and an older extension's bare array
        for reply in ["{\"windows\":[]}", "[]"] {
            let error = parse_stack(reply).expect_err("not the reply object");
            assert_eq!(error.code, ErrorCode::Internal, "{reply}");
            assert!(
                error.message.starts_with("gnome windows reply"),
                "{}",
                error.message
            );
        }
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
            4,
            "the editor, its dialog, the picture-in-picture window and the top \
             bar; not the minimized window, the other workspace or the desktop"
        );
    }

    #[test]
    fn a_shared_pid_is_told_apart_by_title_and_only_higher_windows_cover() {
        let dialog = placed(Some(1302), "Save As").expect("dialog placed");
        let editor = placed(Some(1302), "notes.txt - Text Editor").expect("editor placed");

        assert_eq!(dialog.address, "22");
        assert_eq!(
            dialog.covering.len(),
            2,
            "only the picture-in-picture window and the top bar"
        );
        assert_eq!(
            editor.covering.len(),
            3,
            "the dialog, the picture-in-picture window and the top bar"
        );
    }

    #[test]
    fn shell_ui_over_every_window_refuses_even_a_shown_unambiguous_window() {
        let mut stack = parse_stack(WINDOWS).expect("windows parse");
        for (state, shell) in [
            (
                "overview",
                ShellState {
                    overview: true,
                    modal: false,
                    locked: false,
                },
            ),
            (
                "modal",
                ShellState {
                    overview: false,
                    modal: true,
                    locked: false,
                },
            ),
            (
                "locked",
                ShellState {
                    overview: false,
                    modal: true,
                    locked: true,
                },
            ),
        ] {
            stack.shell = shell;
            let error = place(&stack, &window(Some(1201), "~ : bash")).expect_err(state);
            assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{state}");
            assert!(
                error.message.contains("gnome-window-unresolved"),
                "{state}: {}",
                error.message
            );
        }
    }

    #[test]
    fn empty_chrome_rects_cover_nothing() {
        let mut stack = parse_stack(WINDOWS).expect("windows parse");
        stack.chrome.push(ChromeRect {
            x: 5,
            y: 5,
            width: 0,
            height: 40,
        });

        let placement = place(&stack, &window(Some(1605), "Picture-in-Picture")).expect("placed");

        assert_eq!(placement.covering.len(), 1, "only the top bar");
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
    fn a_reply_that_is_not_the_reply_object_is_refused() {
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
