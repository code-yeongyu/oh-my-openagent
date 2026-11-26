//! What the backend reports: `capabilities()`, the doctor checks, and the input state the QA
//! scenarios and tests read. Reads never open a portal dialog; on the socket route a read may
//! connect, which costs none.

use omo_computer_core::backend::{refusing_capabilities, BackendProbes};
use omo_computer_core::capabilities::{
    BackgroundReach, Capabilities, Compositor, CompositorName, InputMode,
};
use omo_computer_core::results::{ProbeCheck, ProbeState};

use super::WAYLAND_BACKEND;
use crate::clipboard::ClipboardRoute;
use crate::input::{Input, Link};
use crate::ledger::ReleaseProof;
use crate::release;

/// The input connection's state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InputReport {
    pub ready: bool,
    pub reconnects: u32,
    /// The layouts of the keymap the compositor fed.
    pub layouts: Vec<String>,
    pub active_group: Option<String>,
}

pub fn report(input: &Input) -> InputReport {
    let session = input.current();
    let keymap = input.keymap();
    InputReport {
        ready: session.is_some_and(crate::input::EiSession::ready),
        reconnects: input.reconnects,
        layouts: keymap
            .map(|keymap| keymap.layouts().to_vec())
            .unwrap_or_default(),
        active_group: keymap
            .zip(session)
            .map(|(keymap, session)| keymap.group_name(session.group())),
    }
}

pub fn capabilities(
    compositor: CompositorName,
    proof: ReleaseProof,
    input: &Input,
) -> Capabilities {
    let mut capabilities = refusing_capabilities();
    WAYLAND_BACKEND.clone_into(&mut capabilities.backend);
    capabilities.release_helper = Some(release::capability(proof));
    // Stock Wayland has no background window input: only the accessibility route reaches a
    // window that is not focused (and under a contradicted release, nothing else is admitted).
    capabilities.background_reach = BackgroundReach::AxOnly;
    if !matches!(input.link, Link::Unavailable) {
        capabilities.input_modes = vec![InputMode::Pointer, InputMode::Keyboard];
    }
    capabilities.compositor = Some(Compositor {
        name: compositor,
        version: None,
        nested: false,
        virtual_server: None,
        session_lock_protocol: false,
    });
    capabilities
}

fn check(name: &str, state: ProbeState, reason: Option<String>) -> ProbeCheck {
    ProbeCheck {
        name: name.to_owned(),
        state,
        reason,
    }
}

pub fn diagnose(
    proof: ReleaseProof,
    clipboard: ClipboardRoute,
    input: &mut Input,
) -> BackendProbes {
    let libei = match input.link {
        Link::Socket(_) => match input.session() {
            Ok(_) => check("libei", ProbeState::Ok, Some("libei_socket".to_owned())),
            Err(refusal) => check(
                "libei",
                ProbeState::Unavailable,
                refusal.reason.map(|reason| reason.wire().to_owned()),
            ),
        },
        Link::Portal(_) if input.current().is_some() => {
            check("libei", ProbeState::Ok, Some("portal".to_owned()))
        }
        Link::Portal(_) => check(
            "libei",
            ProbeState::Unknown,
            Some("connects_on_first_input".to_owned()),
        ),
        Link::Unavailable => check(
            "libei",
            ProbeState::Unavailable,
            Some("no_remote_desktop_portal".to_owned()),
        ),
    };
    let state = report(input);
    let keymap = if state.layouts.is_empty() {
        check("keymap", ProbeState::Unknown, None)
    } else {
        check("keymap", ProbeState::Ok, Some(state.layouts.join(", ")))
    };
    let release = match proof {
        ReleaseProof::Confirmed => check("release_on_close", ProbeState::Ok, None),
        ReleaseProof::Unproven | ReleaseProof::Contradicts => check(
            "release_on_close",
            ProbeState::Unavailable,
            Some("wayland_release_unproven".to_owned()),
        ),
    };
    let clipboard = match clipboard {
        ClipboardRoute::DataControl => {
            check("clipboard", ProbeState::Ok, Some("data_control".to_owned()))
        }
        ClipboardRoute::PortalClipboard => check(
            "clipboard",
            ProbeState::Ok,
            Some("portal_clipboard".to_owned()),
        ),
        ClipboardRoute::None => check(
            "clipboard",
            ProbeState::Unavailable,
            Some("no_clipboard_route".to_owned()),
        ),
    };
    let reconnects = check(
        "libei_reconnects",
        ProbeState::Ok,
        Some(state.reconnects.to_string()),
    );
    BackendProbes {
        checks: vec![libei, keymap, release, clipboard, reconnects],
        ..BackendProbes::default()
    }
}
