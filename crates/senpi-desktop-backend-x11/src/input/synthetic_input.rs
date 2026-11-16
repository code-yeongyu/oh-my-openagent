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
use super::xterm_resources::allows_send_events;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Acceptance {
    /// The client maps `library`, a toolkit that dispatches sent events.
    Accepts { library: String },
    /// The client's toolkit drops sent events; `evidence` says how it was named.
    Drops { toolkit: Toolkit, evidence: String },
    /// Nothing shows the client dispatches sent events.
    Unproven { why: String },
}

/// Classifies the client of a window from its `WM_CLASS`, its process (read
/// only when the class names no filtering toolkit) and the display's
/// `RESOURCE_MANAGER` database.
pub fn acceptance(
    wm_class: &[u8],
    client: impl FnOnce() -> Result<ClientProcess, String>,
    resources: &[u8],
) -> Acceptance {
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
    if let Some((instance, class)) = xterm_identity(wm_class, &process.args) {
        if !allows_send_events(&instance, &class, &process.args, resources) {
            return Acceptance::Drops {
                toolkit: Toolkit::Xterm,
                evidence: format!("no resource for {instance}/{class} sets allowSendEvents to true"),
            };
        }
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

/// The resource instance and class of an xterm client (its `WM_CLASS`
/// parts, `xterm`/`XTerm` when it has none), or `None` for another program.
fn xterm_identity(wm_class: &[u8], args: &[String]) -> Option<(String, String)> {
    let parts: Vec<String> = wm_class
        .split(|&byte| byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect();
    let class_is_xterm = parts.iter().any(|part| part.eq_ignore_ascii_case("xterm"));
    let program_is_xterm = args
        .first()
        .and_then(|program| program.rsplit('/').next())
        .is_some_and(|name| name == "xterm");
    if !(class_is_xterm || program_is_xterm) {
        return None;
    }
    match parts.as_slice() {
        [instance, class, ..] => Some((instance.clone(), class.clone())),
        _ => Some(("xterm".to_owned(), "XTerm".to_owned())),
    }
}
