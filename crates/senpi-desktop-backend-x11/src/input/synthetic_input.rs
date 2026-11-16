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
    if is_xterm(wm_class, &process.args) && !allows_send_events(&process.args, resources) {
        return Acceptance::Drops {
            toolkit: Toolkit::Xterm,
            evidence: "allowSendEvents is not set to true".to_owned(),
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

fn is_xterm(wm_class: &[u8], args: &[String]) -> bool {
    let class_is_xterm = wm_class
        .split(|&byte| byte == 0)
        .any(|part| part.eq_ignore_ascii_case(b"xterm"));
    let program_is_xterm = args
        .first()
        .and_then(|program| program.rsplit('/').next())
        .is_some_and(|name| name == "xterm");
    class_is_xterm || program_is_xterm
}

/// xterm's `allowSendEvents`, from a `-xrm` argument or the resource
/// database; the last setting wins, as in Xrm.
fn allows_send_events(args: &[String], resources: &[u8]) -> bool {
    let from_args = args
        .windows(2)
        .filter(|pair| pair[0] == "-xrm")
        .map(|pair| pair[1].as_str());
    let database = String::from_utf8_lossy(resources);
    database
        .lines()
        .chain(from_args)
        .filter_map(allow_send_events_value)
        .last()
        .unwrap_or(false)
}

fn allow_send_events_value(line: &str) -> Option<bool> {
    let (key, value) = line.split_once(':')?;
    let key = key.trim().to_ascii_lowercase();
    if !(key.ends_with(".allowsendevents") || key.ends_with("*allowsendevents") || key == "allowsendevents") {
        return None;
    }
    Some(matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "on" | "yes"))
}
