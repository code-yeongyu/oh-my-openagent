//! Whether one observer event satisfies a `waitFor` predicate. A window predicate that names
//! a title or an app reads the root of the event's window (one AX read, never a listing).

use omo_computer_core::ax::AxReader;
use omo_computer_core::backend::AxEvent;
use omo_computer_core::listing::SurfaceKind;
use omo_computer_core::params::{EventKind, SurfaceState, WindowState};

use super::kinds::{event_kind, window_state};

/// The predicates an observer event alone can satisfy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventMatch {
    Window {
        state: WindowState,
        title: Option<String>,
        app: Option<String>,
    },
    Surface {
        kind: SurfaceKind,
        state: SurfaceState,
    },
    Event(EventKind),
}

fn surface_name(kind: SurfaceKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(|name| name.replace('_', "")))
        .unwrap_or_default()
}

/// A surface event: its kind names the surface (`AXSheetCreated`, `sheet_appeared`, ...) and
/// an appearing or a disappearing verb.
fn surface_matches(kind: SurfaceKind, state: SurfaceState, event: &str) -> bool {
    let event = event.to_ascii_lowercase().replace(['_', ':', '-'], "");
    let verbs: &[&str] = match state {
        SurfaceState::Appeared => &["created", "appeared", "opened", "shown"],
        SurfaceState::Gone => &["destroyed", "gone", "closed", "hidden"],
    };
    event.contains(&surface_name(kind)) && verbs.iter().any(|verb| event.contains(verb))
}

fn window_matches(
    reader: Option<&mut dyn AxReader>,
    event: &AxEvent,
    title: Option<&str>,
    app: Option<&str>,
) -> bool {
    if title.is_none() && app.is_none() {
        return true;
    }
    let Some(root) = reader.and_then(|reader| reader.root(&event.window).ok()) else {
        return false;
    };
    let title_ok = title.is_none_or(|wanted| {
        root.node
            .title
            .as_deref()
            .is_some_and(|seen| seen.contains(wanted))
    });
    title_ok && app.is_none_or(|wanted| root.app == wanted)
}

impl EventMatch {
    /// Whether `event` satisfies the predicate.
    pub fn matches(&self, event: &AxEvent, reader: Option<&mut dyn AxReader>) -> bool {
        match self {
            Self::Window { state, title, app } => {
                window_state(&event.kind) == Some(*state)
                    && (*state == WindowState::Gone
                        || window_matches(reader, event, title.as_deref(), app.as_deref()))
            }
            Self::Surface { kind, state } => surface_matches(*kind, *state, &event.kind),
            Self::Event(kind) => event_kind(&event.kind) == Some(*kind),
        }
    }
}
