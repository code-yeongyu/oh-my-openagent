//! Chromium and Electron wake (design: 'Chromium/Electron enhanced UI'). A Chromium-family
//! window whose tree is empty starts building it when the app's `AXRole` is read; the reader
//! then waits on the observer feed for the tree, at most [`WAKE_STEP_MS`] per step inside the
//! observe deadline, with no sleep. Only an Electron window that stayed empty gets
//! `AXManualAccessibility`, and its own fresh step to build the tree. The reader wakes a
//! window once; the attribute that reflows the whole app is never written.

use omo_computer_core::ax::{Slice, SLICE_MS};

use super::seam::{Attributes, AxServer, AxValue, Element, WindowOwner};

/// Bundle ids of the Chromium family, matched exactly or as a dotted prefix
/// (`com.google.Chrome.` matches `com.google.Chrome.canary`). Row 44's route table owns the
/// full `chromium_electron` class; this seed only decides whether an empty tree is woken.
pub const CHROMIUM_BUNDLES: [&str; 8] = [
    "com.google.Chrome",
    "org.chromium.Chromium",
    "com.microsoft.edgemac",
    "com.brave.Browser",
    "com.vivaldi.Vivaldi",
    "com.operasoftware.Opera",
    "company.thebrowser.Browser",
    "com.electron",
];

/// How long one wake step (after the poke, after the write) waits for the tree.
pub const WAKE_STEP_MS: u64 = 500;

fn step_until(server: &dyn AxServer, deadline_ms: u64) -> u64 {
    server
        .now_ms()
        .saturating_add(WAKE_STEP_MS)
        .min(deadline_ms)
}

fn chromium(bundle: Option<&str>) -> bool {
    bundle.is_some_and(|bundle| {
        CHROMIUM_BUNDLES.iter().any(|id| {
            bundle == *id
                || bundle
                    .strip_prefix(id)
                    .is_some_and(|rest| rest.starts_with('.'))
        })
    })
}

/// Wakes an empty window tree; `Some` with the window's fresh attributes once it has children.
pub fn wake(
    server: &mut dyn AxServer,
    owner: &WindowOwner,
    window: Element,
    deadline_ms: u64,
) -> Option<Attributes> {
    let electron = server.is_electron(owner.pid);
    if !electron && !chromium(owner.bundle.as_deref()) {
        return None;
    }
    let app = server.app(owner.pid)?;
    server.poke_role(app);
    let until = step_until(server, deadline_ms);
    if let Some(woken) = wait_for_children(server, window, until) {
        return Some(woken);
    }
    if electron {
        server.set(app, "AXManualAccessibility", AxValue::Bool(true));
        let until = step_until(server, deadline_ms);
        return wait_for_children(server, window, until);
    }
    None
}

fn wait_for_children(
    server: &mut dyn AxServer,
    window: Element,
    deadline_ms: u64,
) -> Option<Attributes> {
    loop {
        let event = server.wait_notification(deadline_ms);
        if let Slice::Read(Some(attributes)) = server.read(window, SLICE_MS) {
            if attributes.child_count > 0 {
                return Some(attributes);
            }
        }
        if event.is_none() || server.now_ms() >= deadline_ms {
            return None;
        }
    }
}
