//! Element properties: the normalized props the snapshot walker renders and
//! the raw UIA property dump behind `ax.attributes`.

use senpi_desktop_core::ax::{normalize_role_uia, AxBounds, AxProps};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopDisplay;
use uiautomation::types::{Rect, UIProperty};
use uiautomation::{UIElement, UITreeWalker};

use super::{patterns, uia_error};
use crate::capture::{logical_bounds, PhysicalRect};

const MAX_ATTRIBUTE_CHARS: usize = 200;

/// Every property `attributes` reports when the element answers it.
const ATTRIBUTE_PROPERTIES: [UIProperty; 30] = [
    UIProperty::RuntimeId,
    UIProperty::BoundingRectangle,
    UIProperty::ProcessId,
    UIProperty::ControlType,
    UIProperty::LocalizedControlType,
    UIProperty::Name,
    UIProperty::AcceleratorKey,
    UIProperty::AccessKey,
    UIProperty::HasKeyboardFocus,
    UIProperty::IsKeyboardFocusable,
    UIProperty::IsEnabled,
    UIProperty::AutomationId,
    UIProperty::ClassName,
    UIProperty::HelpText,
    UIProperty::ClickablePoint,
    UIProperty::Culture,
    UIProperty::IsControlElement,
    UIProperty::IsContentElement,
    UIProperty::IsPassword,
    UIProperty::NativeWindowHandle,
    UIProperty::ItemType,
    UIProperty::IsOffscreen,
    UIProperty::Orientation,
    UIProperty::FrameworkId,
    UIProperty::IsRequiredForForm,
    UIProperty::ItemStatus,
    UIProperty::AriaRole,
    UIProperty::AriaProperties,
    UIProperty::ProviderDescription,
    UIProperty::FullDescription,
];

/// Reads `element`'s props; bounds are logical against `displays` and absent
/// without a layout.
pub(super) fn read_props(
    element: &UIElement,
    walker: &UITreeWalker,
    displays: Option<&[DesktopDisplay]>,
) -> CoreResult<AxProps> {
    let native_role = element.get_control_type().map_err(uia_error)?.to_string();
    let child_count = walker
        .get_children(element)
        .map_or(0, |children| u32::try_from(children.len()).unwrap_or(u32::MAX));
    Ok(AxProps {
        role: normalize_role_uia(&native_role),
        native_role,
        title: element.get_name().ok().filter(|name| !name.is_empty()),
        value: patterns::value(element),
        description: element.get_help_text().ok().filter(|help| !help.is_empty()),
        enabled: element.is_enabled().unwrap_or(false),
        focused: element.has_keyboard_focus().unwrap_or(false),
        bounds: displays.and_then(|displays| {
            element
                .get_bounding_rectangle()
                .ok()
                .and_then(|rect| bounds(&rect, displays))
        }),
        actions: patterns::supported(element).action_names(),
        child_count,
    })
}

/// Logical bounds of a physical rect; `None` for UIA's empty rect (an
/// off-screen or zero-size element).
fn bounds(rect: &Rect, displays: &[DesktopDisplay]) -> Option<AxBounds> {
    let width = u32::try_from(rect.get_right().checked_sub(rect.get_left())?).ok()?;
    let height = u32::try_from(rect.get_bottom().checked_sub(rect.get_top())?).ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let physical = PhysicalRect {
        x: rect.get_left(),
        y: rect.get_top(),
        width,
        height,
    };
    Some(logical_bounds(physical, displays))
}

/// The answered properties as `(name, value)`, values capped at 200 chars.
pub(super) fn attributes(element: &UIElement) -> Vec<(String, String)> {
    ATTRIBUTE_PROPERTIES
        .into_iter()
        .filter_map(|property| {
            let value = element.get_property_value(property).ok()?;
            (!value.is_null()).then(|| (property.to_string(), truncate(&value.to_string())))
        })
        .collect()
}

fn truncate(value: &str) -> String {
    if value.chars().count() <= MAX_ATTRIBUTE_CHARS {
        return value.to_string();
    }
    value
        .chars()
        .take(MAX_ATTRIBUTE_CHARS - 1)
        .chain(std::iter::once('\u{2026}'))
        .collect()
}
