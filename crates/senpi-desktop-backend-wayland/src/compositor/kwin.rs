//! KWin window geometry over its D-Bus scripting API, probed only when
//! `XDG_CURRENT_DESKTOP` names KDE. KWin offers no D-Bus call that lists
//! windows, so a placement loads a read-only script (`org.kde.kwin.Scripting`
//! `loadScript` + `org.kde.kwin.Script.run`) that reads
//! `workspace.stackingOrder` and hands it back with `callDBus` to an object
//! this process serves for that one request, then unloads it. The script
//! changes nothing: input never goes through KWin, pointer input stays on
//! libei, and this module only says where a target window is and which shown
//! windows are stacked above it.

use std::ffi::OsString;
use std::fs::OpenOptions;
use std::future::Future;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::Mutex;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use serde::Deserialize;
use tokio::sync::oneshot;
use zbus::message::Header;
use zbus::Connection;

use super::hyprland::{Placement, WindowRect};
use crate::portal::portal_runtime;

pub const DESKTOP_ENV: &str = "XDG_CURRENT_DESKTOP";
pub const KWIN_SERVICE: &str = "org.kde.KWin";
const SCRIPTING_PATH: &str = "/Scripting";
const SCRIPTING_IFACE: &str = "org.kde.kwin.Scripting";
const SCRIPT_IFACE: &str = "org.kde.kwin.Script";
const SINK_IFACE: &str = "dev.omo.SenpiDesktop.KwinGeometry";
const SINK_PATH_PREFIX: &str = "/dev/omo/SenpiDesktop/KwinGeometry";
/// Bound on each bus call and on the script's reply, so a stuck compositor
/// cannot hang capabilities or input.
const CALL_TIMEOUT: Duration = Duration::from_secs(2);
/// Bound on one reply; an entry is ~150 bytes per window.
const REPLY_LIMIT: usize = 16 * 1024 * 1024;

static REQUESTS: AtomicU64 = AtomicU64::new(0);

/// One entry of the script's reply, in KWin's stacking order (bottom first).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct KwinWindow {
    /// `internalId`, a UUID string.
    pub id: String,
    /// `0` when KWin does not know the owner.
    pub pid: i64,
    pub caption: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// On the current virtual desktop, not minimized and not hidden.
    pub shown: bool,
    /// The desktop background, which sits below every window.
    #[serde(default, rename = "desktopWindow")]
    pub desktop_window: bool,
}

impl KwinWindow {
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
/// `Internal` when the reply is not the script's JSON array.
pub fn parse_windows(json: &str) -> CoreResult<Vec<KwinWindow>> {
    serde_json::from_str(json)
        .map_err(|err| DesktopError::internal(format!("kwin windows reply: {err}")))
}

fn refuse(window: &DesktopWindow, why: &str) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {} kwin-window-unresolved: {why}; no input was sent",
        window.id
    ))
}

/// Matches the AT-SPI `window` to one KWin window (same pid, and same
/// caption when the pid owns several) and lists the shown windows stacked
/// above it.
///
/// # Errors
/// `BackgroundUnavailable` when the window has no pid, matches no KWin window
/// or more than one, or is minimized, hidden or on another virtual desktop.
pub fn place(windows: &[KwinWindow], window: &DesktopWindow) -> CoreResult<Placement> {
    let pid = window.pid.ok_or_else(|| {
        refuse(
            window,
            "the accessibility tree reports no pid to match a KWin window by",
        )
    })?;
    let owned: Vec<(usize, &KwinWindow)> = windows
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !candidate.desktop_window && candidate.pid == i64::from(pid))
        .collect();
    let candidates: Vec<(usize, &KwinWindow)> = if owned.len() > 1 {
        owned
            .into_iter()
            .filter(|(_, candidate)| candidate.caption == window.title)
            .collect()
    } else {
        owned
    };
    let (stack, target) = match candidates.as_slice() {
        [one] => *one,
        [] => return Err(refuse(window, "no KWin window matches its pid and title")),
        _ => {
            return Err(refuse(
                window,
                "several KWin windows share its pid and title",
            ))
        }
    };
    if !target.shown {
        return Err(refuse(
            window,
            "it is minimized, hidden or on another virtual desktop",
        ));
    }
    let rect = target
        .rect()
        .ok_or_else(|| refuse(window, "KWin reports an empty window size"))?;
    let covering = windows[stack + 1..]
        .iter()
        .filter(|above| above.shown && !above.desktop_window)
        .filter_map(KwinWindow::rect)
        .collect();
    Ok(Placement {
        address: target.id.clone(),
        rect,
        covering,
    })
}

/// What the environment says about KWin.
#[derive(Debug, Clone)]
pub enum Detection {
    NotKwin,
    /// A KDE session, but the session bus offers no KWin scripting object.
    DbusMissing,
    Scripting(Kwin),
}

/// A session-bus connection on which `org.kde.KWin` serves `/Scripting`.
#[derive(Debug, Clone)]
pub struct Kwin {
    connection: Connection,
}

fn is_kde(desktop: Option<&OsString>) -> bool {
    desktop
        .and_then(|desktop| desktop.to_str())
        .is_some_and(|desktop| {
            desktop
                .split(':')
                .any(|name| name.eq_ignore_ascii_case("kde"))
        })
}

async fn offers_scripting(connection: &Connection) -> bool {
    let introspect = connection.call_method(
        Some(KWIN_SERVICE),
        SCRIPTING_PATH,
        Some("org.freedesktop.DBus.Introspectable"),
        "Introspect",
        &(),
    );
    match tokio::time::timeout(CALL_TIMEOUT, introspect).await {
        Ok(Ok(reply)) => reply
            .body()
            .deserialize::<String>()
            .is_ok_and(|xml| xml.contains(&format!("\"{SCRIPTING_IFACE}\""))),
        Ok(Err(_)) | Err(_) => false,
    }
}

/// `NotKwin` off KDE (the bus is never touched); else `Scripting` when
/// `connect` reaches a bus whose `org.kde.KWin` serves `/Scripting`.
pub fn detect_with<F>(desktop: Option<OsString>, connect: impl FnOnce() -> F) -> Detection
where
    F: Future<Output = zbus::Result<Connection>>,
{
    if !is_kde(desktop.as_ref()) {
        return Detection::NotKwin;
    }
    let Ok(runtime) = portal_runtime() else {
        return Detection::DbusMissing;
    };
    runtime.block_on(async {
        match tokio::time::timeout(CALL_TIMEOUT, connect()).await {
            Ok(Ok(connection)) if offers_scripting(&connection).await => {
                Detection::Scripting(Kwin { connection })
            }
            Ok(_) | Err(_) => Detection::DbusMissing,
        }
    })
}

/// Reads `XDG_CURRENT_DESKTOP` now and, on KDE, the session bus.
pub fn detect() -> Detection {
    detect_with(std::env::var_os(DESKTOP_ENV), Connection::session)
}

/// Receives the one `Windows` call of one script run.
struct Sink {
    /// Only KWin's own connection may answer.
    kwin: String,
    reply: Mutex<Option<oneshot::Sender<String>>>,
}

#[zbus::interface(name = "dev.omo.SenpiDesktop.KwinGeometry")]
impl Sink {
    fn windows(&self, #[zbus(header)] header: Header<'_>, json: String) -> zbus::fdo::Result<()> {
        if header.sender().map(|sender| sender.as_str()) != Some(self.kwin.as_str()) {
            return Err(zbus::fdo::Error::AccessDenied(
                "only KWin answers this request".to_owned(),
            ));
        }
        if json.len() > REPLY_LIMIT {
            return Err(zbus::fdo::Error::LimitsExceeded(
                "kwin windows reply too large".to_owned(),
            ));
        }
        if let Some(reply) = self.reply.lock().take() {
            let _ = reply.send(json);
        }
        Ok(())
    }
}

/// The read-only script: it reads the stacking order and calls back once.
pub fn script(service: &str, path: &str) -> String {
    format!(
        r#"(function () {{
  var desktop = workspace.currentDesktop;
  var onDesktop = function (w) {{
    if (w.onAllDesktops) return true;
    if (w.desktops) return w.desktops.some(function (d) {{ return d === desktop || d.id === desktop.id; }});
    return w.desktop === desktop;
  }};
  var out = workspace.stackingOrder.map(function (w) {{
    var g = w.frameGeometry;
    return {{ id: String(w.internalId), pid: w.pid || 0, caption: String(w.caption), x: Math.round(g.x),
      y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height),
      shown: onDesktop(w) && !w.minimized && !w.hidden && !w.deleted, desktopWindow: !!w.desktopWindow }};
  }});
  callDBus("{service}", "{path}", "{SINK_IFACE}", "Windows", JSON.stringify(out));
}})();
"#
    )
}

/// The script file, private to this user and removed on drop.
struct ScriptFile(PathBuf);

impl ScriptFile {
    fn create(name: &str, text: &str) -> CoreResult<Self> {
        let dir =
            std::env::var_os("XDG_RUNTIME_DIR").map_or_else(std::env::temp_dir, PathBuf::from);
        let path = dir.join(format!("{name}.js"));
        let io = |err: std::io::Error| {
            DesktopError::internal(format!("kwin script {}: {err}", path.display()))
        };
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(io)?;
        let script = Self(path.clone());
        file.write_all(text.as_bytes()).map_err(io)?;
        Ok(script)
    }
}

impl Drop for ScriptFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn internal(what: &str, err: impl std::fmt::Display) -> DesktopError {
    DesktopError::internal(format!("kwin {what}: {err}"))
}

impl Kwin {
    async fn call<B>(
        &self,
        path: &str,
        iface: &str,
        method: &str,
        body: &B,
    ) -> CoreResult<zbus::Message>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        let call = self
            .connection
            .call_method(Some(KWIN_SERVICE), path, Some(iface), method, body);
        match tokio::time::timeout(CALL_TIMEOUT, call).await {
            Ok(reply) => reply.map_err(|err| internal(&format!("{iface}.{method}"), err)),
            Err(_) => Err(internal(&format!("{iface}.{method}"), "no reply in time")),
        }
    }

    async fn run_script(
        &self,
        path: &str,
        name: &str,
        answered: oneshot::Receiver<String>,
    ) -> CoreResult<String> {
        let reply = self
            .call(SCRIPTING_PATH, SCRIPTING_IFACE, "loadScript", &(path, name))
            .await?;
        let id: i32 = reply
            .body()
            .deserialize()
            .map_err(|err| internal("loadScript reply", err))?;
        if id < 0 {
            return Err(DesktopError::internal(format!(
                "kwin refused the geometry script ({id})"
            )));
        }
        self.call(
            &format!("{SCRIPTING_PATH}/Script{id}"),
            SCRIPT_IFACE,
            "run",
            &(),
        )
        .await?;
        match tokio::time::timeout(CALL_TIMEOUT, answered).await {
            Ok(Ok(json)) => Ok(json),
            Ok(Err(_)) | Err(_) => Err(DesktopError::internal(format!(
                "kwin geometry script did not answer within {} ms",
                CALL_TIMEOUT.as_millis()
            ))),
        }
    }

    async fn read_windows(&self) -> CoreResult<String> {
        let unique = self
            .connection
            .unique_name()
            .map(ToString::to_string)
            .ok_or_else(|| DesktopError::internal("kwin: the session bus gave no unique name"))?;
        let bus = zbus::fdo::DBusProxy::new(&self.connection)
            .await
            .map_err(|err| internal("bus", err))?;
        let service =
            zbus::names::BusName::try_from(KWIN_SERVICE).map_err(|err| internal("name", err))?;
        let kwin = bus
            .get_name_owner(service)
            .await
            .map_err(|err| internal("owner", err))?
            .to_string();
        let request = REQUESTS.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let name = format!("senpi-desktop-geometry-{pid}-{request}");
        let sink_path = format!("{SINK_PATH_PREFIX}/r{pid}_{request}");
        let (reply, answered) = oneshot::channel();
        let sink = Sink {
            kwin,
            reply: Mutex::new(Some(reply)),
        };
        let server = self.connection.object_server();
        server
            .at(sink_path.as_str(), sink)
            .await
            .map_err(|err| internal("serve", err))?;
        let json = match ScriptFile::create(&name, &script(&unique, &sink_path)) {
            Ok(file) => {
                let path = file.0.to_string_lossy().into_owned();
                let ran = self.run_script(&path, &name, answered).await;
                let _ = self
                    .call(
                        SCRIPTING_PATH,
                        SCRIPTING_IFACE,
                        "unloadScript",
                        &(name.as_str(),),
                    )
                    .await;
                ran
            }
            Err(error) => Err(error),
        };
        let _ = server.remove::<Sink, _>(sink_path.as_str()).await;
        json
    }

    /// Every KWin window in stacking order, read fresh by one script run.
    ///
    /// # Errors
    /// `Internal` when KWin refuses the script or does not answer in time.
    pub fn windows(&self) -> CoreResult<Vec<KwinWindow>> {
        parse_windows(&portal_runtime()?.block_on(self.read_windows())?)
    }

    /// Where `window` is now, read fresh from the compositor.
    ///
    /// # Errors
    /// See [`place`] and [`Kwin::windows`].
    pub fn placement(&self, window: &DesktopWindow) -> CoreResult<Placement> {
        place(&self.windows()?, window)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use senpi_desktop_core::error::ErrorCode;

    use super::*;
    use crate::compositor::hyprland::tests::window;
    use crate::test_support::fake_kwin::FakeKwin;

    /// What the script reports on Plasma 6.2 (stacking order, bottom first):
    /// the desktop, a terminal and an editor side by side, the editor's Save
    /// As dialog over it, a minimized window, and the panel on top.
    pub const WINDOWS: &str = r#"[
      {"id":"{0b2d6f40-desk}","pid":901,"caption":"Desktop @ QRect(0,0 2560x1440)","x":0,"y":0,
       "width":2560,"height":1440,"shown":true,"desktopWindow":true},
      {"id":"{1c3e7a51-term}","pid":1201,"caption":"~ : bash","x":10,"y":48,"width":1260,"height":1012,
       "shown":true,"desktopWindow":false},
      {"id":"{2d4f8b62-edit}","pid":1302,"caption":"notes.txt - Kate","x":1290,"y":48,"width":1260,
       "height":1012,"shown":true,"desktopWindow":false},
      {"id":"{3e509c73-save}","pid":1302,"caption":"Save As - Kate","x":1500,"y":300,"width":600,
       "height":400,"shown":true,"desktopWindow":false},
      {"id":"{4f61ad84-mini}","pid":1403,"caption":"Docs - Firefox","x":200,"y":100,"width":1000,
       "height":800,"shown":false,"desktopWindow":false},
      {"id":"{5a72be95-panel}","pid":901,"caption":"plasmashell","x":0,"y":1396,"width":2560,"height":44,
       "shown":true,"desktopWindow":false}
    ]"#;

    fn placed(pid: Option<u32>, title: &str) -> CoreResult<Placement> {
        place(
            &parse_windows(WINDOWS).expect("windows parse"),
            &window(pid, title),
        )
    }

    #[test]
    fn the_script_reply_parses_geometry_identity_and_visibility() {
        let windows = parse_windows(WINDOWS).expect("windows parse");

        assert_eq!(windows.len(), 6);
        assert_eq!(windows[2].id, "{2d4f8b62-edit}");
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
    }

    #[test]
    fn a_malformed_reply_is_an_internal_error() {
        let error = parse_windows("{\"windows\":[]}").expect_err("an object is not the reply");
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.starts_with("kwin windows reply"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_window_is_placed_by_pid_with_the_shown_windows_above_it_covering() {
        let placement = placed(Some(1201), "~ : bash").expect("terminal placed");

        assert_eq!(placement.address, "{1c3e7a51-term}");
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
            "the editor, its dialog and the panel; not the minimized window or the desktop"
        );
    }

    #[test]
    fn a_shared_pid_is_told_apart_by_caption_and_only_higher_windows_cover() {
        let dialog = placed(Some(1302), "Save As - Kate").expect("dialog placed");
        let editor = placed(Some(1302), "notes.txt - Kate").expect("editor placed");

        assert_eq!(dialog.address, "{3e509c73-save}");
        assert_eq!(
            dialog.covering.len(),
            1,
            "only the panel is above the dialog"
        );
        assert_eq!(editor.covering.len(), 2, "the dialog and the panel");
    }

    #[test]
    fn unmatched_ambiguous_pidless_and_minimized_windows_are_refused() {
        for (pid, title) in [
            (Some(9999), "~ : bash"),
            (Some(1302), "Untitled - Kate"),
            (None, "~ : bash"),
            (Some(1403), "Docs - Firefox"),
        ] {
            let error = placed(pid, title).expect_err("must be refused");
            assert_eq!(
                error.code,
                ErrorCode::BackgroundUnavailable,
                "{pid:?} {title}"
            );
            assert!(
                error.message.contains("kwin-window-unresolved"),
                "{}",
                error.message
            );
        }
    }

    #[test]
    fn detection_touches_no_bus_off_kde() {
        fn no_bus() -> zbus::Result<Connection> {
            panic!("the bus must not be touched off KDE")
        }
        for desktop in [
            None,
            Some("GNOME"),
            Some("sway"),
            Some("Hyprland"),
            Some(""),
        ] {
            let detection = detect_with(desktop.map(OsString::from), || async { no_bus() });
            assert!(matches!(detection, Detection::NotKwin), "{desktop:?}");
        }
    }

    #[test]
    fn a_kde_session_without_kwin_scripting_is_dbus_missing() {
        let empty = FakeKwin::bus_only();
        let unreachable = detect_with(Some("KDE".into()), || async {
            Err::<Connection, _>(zbus::Error::Address("no session bus".to_owned()))
        });
        let no_owner = detect_with(Some("ubuntu:KDE".into()), || empty.connect());

        assert!(matches!(unreachable, Detection::DbusMissing));
        assert!(matches!(no_owner, Detection::DbusMissing));
    }

    #[test]
    fn a_kde_session_with_kwin_scripting_is_detected() {
        let kwin = FakeKwin::serve(WINDOWS);

        let detection = detect_with(Some("KDE".into()), || kwin.connect());

        assert!(matches!(detection, Detection::Scripting(_)));
    }

    #[test]
    fn placement_runs_one_read_only_script_and_unloads_it() {
        // Given: a fake KWin that answers the script with WINDOWS
        let kwin = FakeKwin::serve(WINDOWS);
        let Detection::Scripting(scripting) = detect_with(Some("KDE".into()), || kwin.connect())
        else {
            panic!("kwin scripting not detected");
        };

        // When
        let placement = scripting
            .placement(&window(Some(1201), "~ : bash"))
            .expect("placed over D-Bus");

        // Then: one load, one run, one unload of the same plugin; the file is gone
        assert_eq!(placement.address, "{1c3e7a51-term}");
        let calls = kwin.calls();
        assert_eq!(
            calls
                .iter()
                .map(|call| call.method.as_str())
                .collect::<Vec<_>>(),
            ["loadScript", "run", "unloadScript"]
        );
        assert_eq!(calls[0].plugin, calls[2].plugin);
        let script = calls[0]
            .script
            .as_deref()
            .expect("script text read at load");
        assert!(script.contains("workspace.stackingOrder"), "{script}");
        assert!(!calls[0].path.exists(), "the script file is removed");
    }

    #[test]
    fn an_answer_from_another_connection_than_kwin_is_rejected() {
        let kwin = FakeKwin::impostor(WINDOWS);
        let Detection::Scripting(scripting) = detect_with(Some("KDE".into()), || kwin.connect())
        else {
            panic!("kwin scripting not detected");
        };

        let error = scripting
            .windows()
            .expect_err("an impostor's geometry must not be used");

        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.contains("only KWin answers this request"),
            "{}",
            error.message
        );
        assert_eq!(
            kwin.calls().last().map(|call| call.method.as_str()),
            Some("unloadScript")
        );
    }

    #[test]
    fn a_script_that_never_answers_times_out_and_is_still_unloaded() {
        let kwin = FakeKwin::silent();
        let Detection::Scripting(scripting) = detect_with(Some("KDE".into()), || kwin.connect())
        else {
            panic!("kwin scripting not detected");
        };

        let error = scripting.windows().expect_err("no answer must be refused");

        assert_eq!(error.code, ErrorCode::Internal);
        assert!(
            error.message.contains("did not answer"),
            "{}",
            error.message
        );
        assert_eq!(
            kwin.calls().last().map(|call| call.method.as_str()),
            Some("unloadScript")
        );
    }
}
