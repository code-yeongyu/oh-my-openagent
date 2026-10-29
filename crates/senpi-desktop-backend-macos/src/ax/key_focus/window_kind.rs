//! Classifies the focused element's actual window, not the focused leaf.
//! An unreadable role is distinct from a known ordinary window or popover.

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::CFString;

use crate::ax::element::copy_attribute_result;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ElementWindowKind {
    Sheet,
    Popover,
    Ordinary,
    #[default]
    Unknown,
}

pub(super) fn read(window: &AXUIElement) -> crate::ax::ElementWindowKind {
    classify(text(window, "AXRole"), text(window, "AXSubrole"))
}

fn text(window: &AXUIElement, attribute: &str) -> Result<Option<String>, AXError> {
    match copy_attribute_result(window, attribute) {
        Ok(None) | Err(AXError::NoValue | AXError::AttributeUnsupported) => Ok(None),
        Ok(Some(value)) => value
            .downcast::<CFString>()
            .map(|value| Some(value.to_string()))
            .map_err(|_| AXError::Failure),
        Err(error) => Err(error),
    }
}

pub(super) fn classify(
    role: Result<Option<String>, AXError>,
    subrole: Result<Option<String>, AXError>,
) -> ElementWindowKind {
    let names = [
        role.as_ref().ok().and_then(|value| value.as_deref()),
        subrole.as_ref().ok().and_then(|value| value.as_deref()),
    ];
    if names.contains(&Some("AXSheet")) {
        return ElementWindowKind::Sheet;
    }
    if names.contains(&Some("AXPopover")) {
        return ElementWindowKind::Popover;
    }
    if role.is_err() || subrole.is_err() || names == [None, None] {
        return ElementWindowKind::Unknown;
    }
    ElementWindowKind::Ordinary
}
