//! `AxProps` mapping over an attribute-reader seam, so the mapping is testable
//! without a live accessibility server.

use objc2_application_services::AXUIElement;
use objc2_core_foundation::{CFBoolean, CFString, CFType};
use senpi_desktop_core::ax::{normalize_role_macos, AxBounds, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::element::{self, copy_attribute_result};

/// The attribute reads `props` needs from one accessibility element.
pub(super) trait AttributeSource {
    /// A required string attribute; absence or a non-string is an error.
    fn required_string(&self, attribute: &str) -> CoreResult<String>;
    fn string(&self, attribute: &str) -> Option<String>;
    /// Any attribute value rendered as text (`AXValue` may be a number).
    fn value_string(&self, attribute: &str) -> Option<String>;
    fn boolean(&self, attribute: &str) -> Option<bool>;
    fn bounds(&self) -> Option<AxBounds>;
    fn action_names(&self) -> Vec<String>;
    fn child_count(&self) -> u32;
}

impl AttributeSource for AXUIElement {
    fn required_string(&self, attribute: &str) -> CoreResult<String> {
        copy_attribute_result(self, attribute)
            .map_err(|error| DesktopError::ax_failed(format!("copying {attribute} failed ({error:?})")))?
            .ok_or_else(|| DesktopError::ax_failed(format!("copying {attribute} returned no value")))?
            .downcast::<CFString>()
            .map(|value| value.to_string())
            .map_err(|_| DesktopError::ax_failed(format!("{attribute} was not a string")))
    }

    fn string(&self, attribute: &str) -> Option<String> {
        element::copy_string(self, attribute)
    }

    fn value_string(&self, attribute: &str) -> Option<String> {
        element::copy_attribute(self, attribute).map(|value| stringify_value(&value))
    }

    fn boolean(&self, attribute: &str) -> Option<bool> {
        element::copy_bool(self, attribute)
    }

    fn bounds(&self) -> Option<AxBounds> {
        element::bounds(self)
    }

    fn action_names(&self) -> Vec<String> {
        // SAFETY: The slot is writable and receives a create-rule CFArray.
        element::copy_name_array(|slot| unsafe { self.copy_action_names(slot) }).unwrap_or_default()
    }

    fn child_count(&self) -> u32 {
        element::copy_elements(self, "AXChildren")
            .map_or(0, |children| u32::try_from(children.len()).unwrap_or(u32::MAX))
    }
}

pub(super) fn read_props(source: &impl AttributeSource) -> CoreResult<AxProps> {
    let native_role = source.required_string("AXRole")?;
    Ok(AxProps {
        role: normalize_role_macos(&native_role),
        native_role,
        title: nonempty(source.string("AXTitle")),
        value: nonempty(source.value_string("AXValue")),
        description: nonempty(source.string("AXDescription")),
        enabled: source.boolean("AXEnabled").unwrap_or(true),
        focused: source.boolean("AXFocused").unwrap_or(false),
        bounds: source.bounds(),
        actions: source.action_names(),
        child_count: source.child_count(),
    })
}

pub(super) fn stringify_value(value: &CFType) -> String {
    if let Some(string) = value.downcast_ref::<CFString>() {
        return string.to_string();
    }
    if let Some(boolean) = value.downcast_ref::<CFBoolean>() {
        return boolean.as_bool().to_string();
    }
    format!("{value:?}")
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

pub(super) fn truncate_chars(value: String, max: usize) -> String {
    if value.chars().count() <= max {
        return value;
    }
    let mut result: String = value.chars().take(max.saturating_sub(1)).collect();
    result.push('…');
    result
}
