//! Whether a window takes background (`XSendEvent`) input. X11 returns no
//! receipt for a sent event, so background input is sent only to a client
//! whose toolkit is known to dispatch synthetic events; a toolkit known to
//! drop them, or a client nothing is known about, is refused before anything
//! is sent, so the action never reports a delivery the app did not receive
//! (omo#9109). A refusal is `BackgroundUnavailable` with `nothingSent` and the
//! session's next rung (element action, then foreground).

use senpi_desktop_core::error::{DesktopError, ErrorReport};
use senpi_desktop_core::report::Disposition;

use super::client_process::ClientProcess;
use super::toolkit_filter::{accepting_library, class_label, dropping_library, filtering_toolkit, Toolkit};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Acceptance {
    /// The client maps `library`, a toolkit that dispatches sent events.
    Accepts { library: String },
    /// The client's toolkit drops sent events; `evidence` says how it was named.
    Drops { toolkit: Toolkit, evidence: String },
    /// Nothing shows the client dispatches sent events.
    Unproven { why: String },
}

/// Classifies the client of a window from its `WM_CLASS` and its process
/// (read only when the class names no filtering toolkit).
pub fn acceptance(wm_class: &[u8], client: impl FnOnce() -> Result<ClientProcess, String>) -> Acceptance {
    if let Some(toolkit) = filtering_toolkit(wm_class) {
        return Acceptance::Drops {
            toolkit,
            evidence: format!("WM_CLASS {}", class_label(wm_class)),
        };
    }
    let process = match client() {
        Ok(process) => process,
        Err(why) => return Acceptance::Unproven { why },
    };
    if let Some((library, toolkit)) = dropping_library(&process.libraries) {
        return Acceptance::Drops {
            toolkit,
            evidence: format!("its process maps {library}"),
        };
    }
    if process.chromium_helpers {
        return Acceptance::Drops {
            toolkit: Toolkit::Chromium,
            evidence: "its process runs Chromium --type= helpers".to_owned(),
        };
    }
    if is_xterm(wm_class, &process) {
        return Acceptance::Drops {
            toolkit: Toolkit::Xterm,
            evidence: "its allowSendEvents setting cannot be read: Xt merges resource files the engine cannot \
                       see, and the xterm menu turns it off at runtime"
                .to_owned(),
        };
    }
    accepting_library(&process.libraries).map_or_else(
        || Acceptance::Unproven {
            why: "its process maps no toolkit known to accept synthetic input (Xt, Motif, Tk)".to_owned(),
        },
        |library| Acceptance::Accepts {
            library: library.to_owned(),
        },
    )
}

/// The refusal of background `kind` input to `window`, or `None` when the
/// client accepts it.
pub fn refusal(window: &str, kind: &str, acceptance: Acceptance) -> Option<DesktopError> {
    let (reason, cause) = match acceptance {
        Acceptance::Accepts { .. } => return None,
        Acceptance::Drops { toolkit, evidence } => (
            "synthetic_input_dropped",
            format!("{} ({evidence}) drops synthetic XSendEvent input", toolkit.name()),
        ),
        Acceptance::Unproven { why } => (
            "synthetic_input_unproven",
            format!("its delivery cannot be confirmed: {why}"),
        ),
    };
    Some(
        DesktopError::background_unavailable(format!(
            "background {kind} to window {window} was not sent: {cause}; use ax.perform on the \
             element, or retry with delivery:\"foreground\""
        ))
        .with_report(ErrorReport {
            reason: Some(reason.to_owned()),
            disposition: Some(Disposition::NOT_DELIVERED_SAFE),
            ..ErrorReport::default()
        }),
    )
}

/// xterm drops sent events unless its `allowSendEvents` resource is on, and
/// that setting is never fully visible to another client. An xterm is named
/// by its `WM_CLASS`, its `argv[0]`, or the binary its `/proc/<pid>/exe`
/// resolves to (an xterm run through a renamed link with `-name`/`-class`
/// overridden). When the exe link cannot be read, only the first two count;
/// a renamed copy of the binary is not recognised.
fn is_xterm(wm_class: &[u8], process: &ClientProcess) -> bool {
    let names_xterm = |name: &str| name == "xterm" || name == "uxterm";
    let class_is_xterm = wm_class
        .split(|&byte| byte == 0)
        .any(|part| part.eq_ignore_ascii_case(b"xterm") || part.eq_ignore_ascii_case(b"uxterm"));
    let basename = |path: &String| path.rsplit('/').next().is_some_and(names_xterm);
    class_is_xterm || process.args.first().is_some_and(basename) || process.exe.as_ref().is_some_and(basename)
}
