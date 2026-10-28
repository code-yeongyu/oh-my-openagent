//! Selecting text in an element's value through `AXSelectedTextRange`
//! (ported from oh-my-pi 0838d2ab44 ax/selection.rs).
//!
//! The selection is written as a range, so the value, the user's focus and
//! the pointer stay as they were, and no key is sent. Typing or AX insertion
//! into the element then replaces the selection.

use std::ptr::NonNull;
use std::time::Duration;

use objc2_application_services::{AXError, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFRange, CFString};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::intervention::check_press;
use senpi_desktop_core::protocol_results::AxTextSelection;
use senpi_desktop_core::text_range::{utf16_slice, TextSelectRequest, Utf16Range};

use super::element::{
    attribute_settable, copy_bool, copy_held_attribute, copy_range, copy_string, element_gone, element_pid,
};
use super::popup::poll;
use super::replace_value::may_borrow_focus;
use crate::skylight::{mark_sent, reporting_partial};

const SELECTED_RANGE: &str = "AXSelectedTextRange";
/// How long a written selection has to show up in the read-back. Native
/// fields answer on the first read; web content updates its AX selection
/// asynchronously after the DOM selection has already moved.
const SELECTION_SETTLE_WAIT: Duration = Duration::from_millis(500);
const SELECTION_SETTLE_POLL: Duration = Duration::from_millis(10);

/// Selects the range `request` names in `element`'s value.
pub(super) fn select(element: &AXUIElement, request: &TextSelectRequest) -> CoreResult<AxTextSelection> {
    let pid = element_pid(element)?;
    // Selecting moves the caret that typing into a focused field replaces, so
    // an app the user brings forward during the call is left to them.
    let started_in_background = may_borrow_focus(crate::front_app::current_front_pid(), pid);
    // A destroyed element throws `StaleRef` here, as from every element
    // operation, rather than reading as an unsettable one.
    let role = copy_held_attribute(element, "AXRole")?
        .and_then(|value| value.downcast::<CFString>().ok())
        .map_or_else(|| "element".to_owned(), |role| role.to_string());
    if !attribute_settable(element, SELECTED_RANGE) {
        return Err(DesktopError::ax_failed(format!(
            "{SELECTED_RANGE} is not settable on this {role}, so its text cannot be selected by \
             accessibility; nothing was selected"
        )));
    }
    let Some(before) = copy_string(element, "AXValue") else {
        return Err(DesktopError::ax_failed(format!(
            "this {role} has no text AXValue to search; nothing was selected"
        )));
    };
    let wanted = request.locate(&before)?;
    let applied = apply(
        &before,
        wanted,
        |action| reporting_partial(action),
        || started_in_background && !may_borrow_focus(crate::front_app::current_front_pid(), pid),
        || write_range(element, wanted),
        || read_range(element),
        || copy_string(element, "AXValue"),
        SELECTION_SETTLE_WAIT,
    )?;
    let to_u32 = |units: usize| u32::try_from(units).map_err(|_| DesktopError::internal("selection offset exceeds u32"));
    Ok(AxTextSelection {
        start: to_u32(applied.start)?,
        length: to_u32(applied.length)?,
        text: utf16_slice(&before, applied).unwrap_or_default().to_owned(),
        focused: copy_bool(element, "AXFocused").unwrap_or(false),
    })
}

/// Writes `wanted` inside `guard`, lets the read-back settle there, then
/// confirms the selection and value once the guard has finished, so the
/// verdict reflects the element after the guard's own post-action settle.
/// The probes before the write can block: nothing is written once the app
/// came to the front (`brought_forward`) or the user pressed a key or clicked
/// in it since the call was admitted ([`check_press`]).
#[expect(clippy::too_many_arguments, reason = "every seam of the write is injected so the verdict is testable")]
pub(super) fn apply(
    before: &str,
    wanted: Utf16Range,
    guard: impl FnOnce(&mut dyn FnMut() -> CoreResult<()>) -> CoreResult<()>,
    brought_forward: impl Fn() -> bool,
    write: impl Fn() -> CoreResult<()>,
    read_range: impl Fn() -> Option<Utf16Range>,
    read_value: impl Fn() -> Option<String>,
    settle: Duration,
) -> CoreResult<Utf16Range> {
    guard(&mut || {
        if brought_forward() {
            return Err(DesktopError::ax_failed(
                "the app came to the front during the call, so its caret is the user's; nothing was \
                 selected",
            ));
        }
        check_press()?;
        write()?;
        poll(settle, SELECTION_SETTLE_POLL, || (read_range() == Some(wanted)).then_some(()));
        Ok(())
    })?;
    // The write was accepted, so a selection that cannot be read back, as when
    // the app does not reply in time, may already be in place: unconfirmed,
    // not failed.
    let applied = read_range().ok_or_else(|| {
        DesktopError::ax_unconfirmed(format!(
            "AX accepted the selection but {SELECTED_RANGE} could not be read back, so it may \
             already apply: inspect the element's selection before retrying or typing"
        ))
    })?;
    if read_value().as_deref() != Some(before) {
        return Err(DesktopError::ax_failed(format!(
            "the element's value changed while selecting; the selection reads back at UTF-16 {} \
             length {}; inspect the element before typing",
            applied.start, applied.length
        )));
    }
    if applied != wanted {
        return Err(DesktopError::ax_failed(format!(
            "asked to select UTF-16 {} length {} but the element reads back {} length {} ({:?}); a \
             following type would not replace the requested text",
            wanted.start,
            wanted.length,
            applied.start,
            applied.length,
            utf16_slice(before, applied).unwrap_or_default()
        )));
    }
    Ok(applied)
}

/// The element's selection, or `None` when it has none or reports a
/// negative offset.
fn read_range(element: &AXUIElement) -> Option<Utf16Range> {
    let range = copy_range(element, SELECTED_RANGE)?;
    Some(Utf16Range {
        start: usize::try_from(range.location).ok()?,
        length: usize::try_from(range.length).ok()?,
    })
}

fn write_range(element: &AXUIElement, range: Utf16Range) -> CoreResult<()> {
    let to_isize = |units: usize| isize::try_from(units).map_err(|_| DesktopError::internal("selection offset exceeds isize"));
    let range = CFRange {
        location: to_isize(range.start)?,
        length: to_isize(range.length)?,
    };
    // SAFETY: `range` is a live CFRange, the type AXValueCreate is told to copy.
    let value = unsafe { AXValue::new(AXValueType::CFRange, NonNull::from(&range).cast()) }
        .ok_or_else(|| DesktopError::ax_failed("creating the AXValue range failed"))?;
    let attribute = CFString::from_str(SELECTED_RANGE);
    // SAFETY: The element, attribute and range value stay retained for the setter.
    let error = unsafe { element.set_attribute_value(&attribute, &value) };
    if error == AXError::Success || error == AXError::CannotComplete {
        // The app accepted the write or never answered it: the caret may have moved.
        mark_sent();
    }
    write_result(error)
}

/// The outcome of the selection write. `CannotComplete` means the app did not
/// reply in time or messaging failed: the write was made and the caret may
/// already have moved, so the outcome is unconfirmed rather than failed; a
/// destroyed element is a stale ref.
pub(super) fn write_result(error: AXError) -> CoreResult<()> {
    match error {
        AXError::Success => Ok(()),
        AXError::CannotComplete => Err(DesktopError::ax_unconfirmed(format!(
            "setting {SELECTED_RANGE} got no reply in time (CannotComplete) and may still apply: \
             inspect the element's selection before retrying or typing"
        ))),
        AXError::InvalidUIElement => Err(element_gone()),
        error => Err(DesktopError::ax_failed(format!(
            "setting {SELECTED_RANGE} failed ({error:?}); nothing was selected"
        ))),
    }
}
