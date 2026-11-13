//! Text and value: reading an element's text, and `set_value` through
//! EditableText with the numeric Value interface as the fallback.

use atspi::Interface;
use senpi_desktop_core::error::{CoreResult, DesktopError};

use crate::bus::AtSpiBus;

/// Longest text read into an element's `value`, in characters.
const MAX_VALUE_CHARS: i32 = 16_384;

/// The element's text, when it has any.
pub(crate) fn read_value<B: AtSpiBus>(bus: &mut B, node: &B::Node) -> Option<String> {
    bus.text(node, MAX_VALUE_CHARS)
        .ok()
        .filter(|value| !value.is_empty())
}

/// Replaces the element's text; when it has no editable text (or rejects the
/// text) and implements Value, sets `value` parsed as a number instead.
pub(crate) fn set_value<B: AtSpiBus>(bus: &mut B, node: &B::Node, value: &str) -> CoreResult<()> {
    let interfaces = bus.interfaces(node).map_err(DesktopError::ax_failed)?;
    let editable = interfaces.contains(Interface::EditableText);
    if editable
        && bus
            .set_text_contents(node, value)
            .map_err(DesktopError::ax_failed)?
    {
        return Ok(());
    }
    if !interfaces.contains(Interface::Value) {
        return Err(DesktopError::ax_failed(if editable {
            "AT-SPI rejected the text value"
        } else {
            "AT-SPI element has neither editable text nor a value"
        }));
    }
    let number = value
        .trim()
        .parse::<f64>()
        .map_err(|_| DesktopError::ax_failed(format!("AT-SPI value '{value}' is not a number")))?;
    bus.set_current_value(node, number)
        .map_err(DesktopError::ax_failed)
}
