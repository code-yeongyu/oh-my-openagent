//! Element properties and attributes. Only the interface list is required:
//! an object that cannot report it is gone, so the walk skips it. Every other
//! read degrades to "absent", as oh-my-pi's does.

use atspi::{Interface, State};
use senpi_desktop_core::ax::{normalize_role_atspi, AxBounds, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use crate::bus::{AtSpiBus, BusResult, Extents};
use crate::text;

/// Attribute values are cut to this many characters.
const MAX_ATTRIBUTE_CHARS: usize = 200;

fn non_empty(read: BusResult<String>) -> Option<String> {
    read.ok().filter(|value| !value.is_empty())
}

fn bounds(extents: Extents) -> Option<AxBounds> {
    (extents.width >= 0 && extents.height >= 0).then(|| AxBounds {
        x: f64::from(extents.x),
        y: f64::from(extents.y),
        width: f64::from(extents.width),
        height: f64::from(extents.height),
    })
}

pub(crate) fn read_props<B: AtSpiBus>(bus: &mut B, node: &B::Node) -> CoreResult<AxProps> {
    let interfaces = bus.interfaces(node).map_err(DesktopError::ax_failed)?;
    let native_role = bus
        .role_name(node)
        .or_else(|_| bus.localized_role_name(node))
        .unwrap_or_else(|_| "unknown".to_string());
    let state = bus.state(node).ok();
    let has = |flag: State| state.is_some_and(|states| states.contains(flag));
    let value = if interfaces.contains(Interface::Text) {
        text::read_value(bus, node)
    } else {
        None
    };
    let bounds = if interfaces.contains(Interface::Component) {
        bus.extents(node).ok().and_then(bounds)
    } else {
        None
    };
    let actions = if interfaces.contains(Interface::Action) {
        bus.actions(node).unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(AxProps {
        role: normalize_role_atspi(&native_role, has(State::MultiLine)),
        native_role,
        title: non_empty(bus.name(node)),
        value,
        description: non_empty(bus.description(node)),
        enabled: has(State::Enabled),
        focused: has(State::Focused),
        bounds,
        actions,
        child_count: bus
            .child_count(node)
            .map_or(0, |count| u32::try_from(count).unwrap_or(0)),
    })
}

/// Object attributes sorted by key, each value cut to 200 characters.
pub(crate) fn attributes<B: AtSpiBus>(bus: &mut B, node: &B::Node) -> CoreResult<Vec<(String, String)>> {
    let mut attributes: Vec<(String, String)> = bus
        .attributes(node)
        .map_err(DesktopError::ax_failed)?
        .into_iter()
        .map(|(key, value)| (key, value.chars().take(MAX_ATTRIBUTE_CHARS).collect()))
        .collect();
    attributes.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(attributes)
}
