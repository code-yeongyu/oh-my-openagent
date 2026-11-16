//! Text typed into an element by AX insertion: a native text field takes it
//! at its own selection through `AXSelectedText`, read back exactly, with no
//! key sent and no focus moved (ported from oh-my-pi 0838d2ab44
//! `insert_selected_text` and its helpers). Web content and an incomplete
//! ancestry take keys instead, because they can echo a write the renderer
//! never accepted; a secure field never puts its text into an error.

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFRetained, CFString, Type};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::intervention::check_press;
use senpi_desktop_core::text_range::{replace_utf16_selection, Utf16Range};

use super::element::{
    attribute_settable, copy_attribute_result, copy_element, copy_held_attribute, copy_range, copy_string,
    element_gone,
};
use super::props::truncate_chars;
use crate::skylight::{mark_sent, reporting_partial};

/// How many `AXParent` hops the surface walk follows before giving up.
const MAX_ANCESTRY_DEPTH: usize = 64;
/// Read-back values longer than this are cut in an error.
const SHOWN: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TextSurface {
    Native,
    Web,
    Unknown,
}

/// Whether `element` draws in native AppKit text, web content (an
/// `AXWebArea` ancestor), or an ancestry that never reaches a window.
fn text_surface(element: &AXUIElement) -> TextSurface {
    let mut current: CFRetained<AXUIElement> = element.retain();
    for _ in 0..MAX_ANCESTRY_DEPTH {
        match copy_string(&current, "AXRole").as_deref() {
            Some("AXWebArea") => return TextSurface::Web,
            Some("AXWindow" | "AXApplication") => return TextSurface::Native,
            None => return TextSurface::Unknown,
            Some(_) => {}
        }
        let Some(parent) = copy_element(&current, "AXParent") else {
            return TextSurface::Unknown;
        };
        current = parent;
    }
    TextSurface::Unknown
}

/// Whether text goes in by writing `AXSelectedText`: a native text field,
/// text area or combo box whose selection is settable. Web content can echo a
/// write its renderer never accepted, so it takes keystrokes instead.
pub(super) fn takes_inserted_text(
    surface: impl FnOnce() -> TextSurface,
    role: Option<&str>,
    selection_settable: impl FnOnce() -> bool,
) -> bool {
    matches!(role, Some("AXTextField" | "AXTextArea" | "AXComboBox"))
        && surface() == TextSurface::Native
        && selection_settable()
}

/// What an element answered for `AXSubrole`.
pub(super) enum Subrole {
    Absent,
    Named(String),
    /// A value that is not a string.
    Malformed,
}

/// A subrole that could not be read, or was not a string, counts as secure, so
/// neither a timeout nor a malformed answer lets a password into an error; a
/// field without one is not secure.
pub(super) fn secure_subrole(read: Result<Subrole, AXError>) -> bool {
    match read {
        Ok(Subrole::Absent) | Err(AXError::NoValue | AXError::AttributeUnsupported) => false,
        Ok(Subrole::Named(subrole)) => subrole == "AXSecureTextField",
        Ok(Subrole::Malformed) | Err(_) => true,
    }
}

pub(super) fn is_secure(element: &AXUIElement) -> bool {
    secure_subrole(copy_attribute_result(element, "AXSubrole").map(|value| match value {
        None => Subrole::Absent,
        Some(value) => value
            .downcast::<CFString>()
            .map_or(Subrole::Malformed, |value| Subrole::Named(value.to_string())),
    }))
}

/// Exact equality is the verdict: a field that shows a rewritten value has
/// not been shown to hold what was sent (Contacts regroups a phone number in
/// the field and stores none of it). The error names what the field reads so
/// the next step needs no extra read, except in a secure field, whose text
/// never enters an error. A value that cannot be read back after an accepted
/// write leaves the outcome unknown (`AxUnconfirmed`), never failed.
pub(super) fn text_readback(sent: &str, expected: &str, actual: Option<&str>, secure: bool) -> CoreResult<()> {
    if actual == Some(expected) {
        return Ok(());
    }
    let quote = |text: &str| format!("{:?}", truncate_chars(text.to_owned(), SHOWN));
    let Some(actual) = actual else {
        let written = if secure {
            "wrote the secure text field".to_owned()
        } else {
            format!("wrote {}", quote(sent))
        };
        return Err(DesktopError::ax_unconfirmed(format!(
            "{written}, but the field's value could not be read back, so the outcome could not be \
             confirmed; inspect the target before writing again"
        )));
    };
    if secure {
        return Err(DesktopError::ax_failed(
            "the secure text field's value differs from what was written; inspect the target before \
             writing again",
        ));
    }
    let whole = if sent == expected {
        String::new()
    } else {
        format!(" instead of {}", quote(expected))
    };
    Err(DesktopError::ax_failed(format!(
        "wrote {}; the field now reads {}{whole}. The app may have reformatted it or not taken it: \
         inspect the target before writing again",
        quote(sent),
        quote(actual),
    )))
}

/// The call's result from the app's reply to the `AXSelectedText` write:
/// accepted; left unanswered (`CannotComplete`, so it may have landed:
/// `AxUnconfirmed`); a destroyed field (`StaleRef`); or refused, after which
/// the text must not be repeated blindly because the write may be partial.
pub(super) fn insertion_result(error: AXError) -> CoreResult<()> {
    match error {
        AXError::Success => Ok(()),
        AXError::CannotComplete => Err(DesktopError::ax_unconfirmed(
            "inserting the text was requested, but its outcome could not be confirmed: the app did not \
             reply in time or messaging failed (CannotComplete). It may already have taken effect: \
             observe the window before retrying",
        )),
        AXError::InvalidUIElement => Err(element_gone()),
        error => Err(DesktopError::ax_failed(format!(
            "setting AXSelectedText failed ({error:?}); delivery may be partial, do not blindly repeat \
             the text"
        ))),
    }
}

/// Inserts `text` at `element`'s own selection, whichever element holds
/// keyboard focus, when the element takes inserted text; `Ok(false)` means no
/// write was attempted and the caller may fall back to keys. An attempted
/// write never falls through to keys, including a timeout or a mismatch.
/// Nothing is written once the user has pressed a key or clicked in the
/// application since the call was admitted ([`check_press`]).
pub(crate) fn insert_into_element(element: &AXUIElement, text: &str) -> CoreResult<bool> {
    reporting_partial(|| insert_selected_text(element, text))
}

fn insert_selected_text(element: &AXUIElement, text: &str) -> CoreResult<bool> {
    let role = copy_held_attribute(element, "AXRole")?
        .and_then(|value| value.downcast::<CFString>().ok())
        .map(|value| value.to_string());
    if !takes_inserted_text(
        || text_surface(element),
        role.as_deref(),
        || attribute_settable(element, "AXSelectedText"),
    ) {
        return Ok(false);
    }
    let Some(before) = copy_string(element, "AXValue") else {
        return Ok(false);
    };
    let Some(range) = copy_range(element, "AXSelectedTextRange") else {
        return Ok(false);
    };
    let (Ok(start), Ok(length)) = (usize::try_from(range.location), usize::try_from(range.length)) else {
        return Ok(false);
    };
    // A selection the value cannot hold (it moved under the read) attempts no
    // write: keys follow instead.
    let Ok(expected) = replace_utf16_selection(&before, Utf16Range { start, length }, text) else {
        return Ok(false);
    };
    let secure = is_secure(element);
    check_press()?;
    let attribute = CFString::from_str("AXSelectedText");
    let value = CFString::from_str(text);
    // SAFETY: The element, attribute and string stay retained for the setter.
    let error = unsafe { element.set_attribute_value(&attribute, &value) };
    if error == AXError::Success || error == AXError::CannotComplete {
        // The app accepted the write or never answered it: either way the
        // text may be in the field now.
        mark_sent();
    }
    insertion_result(error)?;
    text_readback(text, &expected, copy_string(element, "AXValue").as_deref(), secure)?;
    Ok(true)
}
