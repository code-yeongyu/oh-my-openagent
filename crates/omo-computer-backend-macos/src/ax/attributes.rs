//! One attribute read as the observation model's node, and the loading predicate (A4).

use omo_computer_core::ax::{AxHandle, Evidence, NodeRead};
use omo_computer_core::observation::BusyIndicator;

use super::seam::Attributes;

const SECURE_SUBROLE: &str = "AXSecureTextField";

/// The node the walk sees; a secure field's value is never read out.
#[must_use]
pub fn node(handle: AxHandle, attributes: Attributes) -> NodeRead {
    let secure = attributes.subrole.as_deref() == Some(SECURE_SUBROLE);
    let value = if secure { None } else { attributes.value };
    let checked = (attributes.role == "AXCheckBox" || attributes.role == "AXRadioButton")
        .then(|| value.as_deref().map(|v| v == "1"))
        .flatten();
    NodeRead {
        handle: Some(handle),
        object: Some(omo_computer_core::ax::NativeObject(handle.0)),
        evidence: Evidence::of(
            attributes.title.is_some(),
            value.is_some(),
            attributes.description.is_some(),
        ),
        role: attributes.role,
        native_role: attributes.subrole,
        title: attributes.title,
        description: attributes.description,
        value,
        native_id: attributes.identifier,
        enabled: attributes.enabled,
        focused: attributes.focused,
        selected: attributes.selected,
        expanded: attributes.expanded,
        checked,
        secure,
        actions: attributes.actions,
        bounds: attributes.frame,
        child_count: attributes.child_count,
    }
}

/// The loading indicator one element shows: `AXElementBusy`, a web area not yet loaded, an
/// indeterminate progress indicator, or a busy (spinner) indicator.
#[must_use]
pub fn indicator(attributes: &Attributes) -> Option<BusyIndicator> {
    let spinner = attributes.role == "AXBusyIndicator"
        || attributes
            .subrole
            .as_deref()
            .is_some_and(|s| s.contains("Spinner"));
    if attributes.busy == Some(true)
        || (attributes.role == "AXWebArea" && attributes.loaded == Some(false))
    {
        Some(BusyIndicator::AxBusy)
    } else if attributes.role == "AXProgressIndicator" && attributes.indeterminate == Some(true) {
        Some(BusyIndicator::Progress)
    } else if spinner {
        Some(BusyIndicator::Spinner)
    } else {
        None
    }
}
