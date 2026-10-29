//! `ax.setValue` on a native text field: the whole value replaced through
//! `AXSelectedText`, the path `ax.typeText` inserts by, after focusing the
//! field and selecting all of it, so the app commits what reaches its field
//! editor (several echo an `AXValue` write without ever taking it). Focus is
//! borrowed only from an app already in the background and handed back when
//! nothing was written (ported from oh-my-pi 0838d2ab44 `replace_whole_value`).

use objc2_application_services::{AXError, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFRange, CFRetained, CFString};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::intervention::check_press;

use super::element::{attribute_settable, copy_bool, copy_element, copy_string, create_application, set_timeout};
use super::text_input::{is_secure, set_selected_text, text_readback};
use crate::front_app::current_front_pid;

/// Replaces a native text field's whole value through `AXSelectedText`.
/// `Ok(false)` means nothing was written and the caller may write `AXValue`.
/// A secure field is never selected over: its masked value could not be read
/// back exactly.
pub(super) fn replace_native_text(
    element: &AXUIElement,
    pid: libc::pid_t,
    may_borrow: bool,
    text: &str,
) -> CoreResult<bool> {
    if !matches!(
        copy_string(element, "AXRole").as_deref(),
        Some("AXTextField" | "AXTextArea" | "AXComboBox")
    ) || is_secure(element)
    {
        return Ok(false);
    }
    replace_whole_value(&LiveField { element, pid, may_borrow }, text)
}

/// The AX steps of a whole-value replacement, kept apart so the order of its
/// foreground checks can be tested without a live app.
pub(super) trait TextField {
    type Element;
    /// Whether the field holds its app's focus, which is app-local.
    fn focused(&self) -> Option<bool>;
    /// The element that holds the app's focus.
    fn focus_owner(&self) -> Option<Self::Element>;
    /// Whether another app is frontmost ([`may_borrow_focus`]).
    fn in_background(&self) -> bool;
    /// Whether an app that was in the background as the call started has
    /// since come to the front, which means the user is working in it.
    fn brought_forward(&self) -> bool;
    fn focus(&self) -> AXError;
    fn hand_focus_to(&self, owner: &Self::Element) -> AXError;
    /// The whole value's UTF-16 length, when its selection is settable.
    fn selectable_length(&self) -> Option<isize>;
    fn select(&self, length: isize) -> AXError;
    fn insert(&self, text: &str) -> CoreResult<()>;
}

/// Focuses the field when it is not focused (only from a known background
/// app, so the focus can be handed back), selects its whole value, and
/// inserts `text` over it. Every probe can block, so the front app and the
/// user's own input in the app ([`check_press`]) are re-read right before
/// the focus write and the selection write: a field the user now works in is
/// left alone. `Ok(false)` means nothing was written.
pub(super) fn replace_whole_value<F: TextField>(field: &F, text: &str) -> CoreResult<bool> {
    // A setter the app did not answer may still apply: the `AXValue` fallback
    // is skipped rather than written over a focus or selection that may have
    // moved.
    let mut unanswered = None;
    // An unfocused Cocoa field has no field editor, so it publishes no
    // settable selection until it is focused. Focus is borrowed only when the
    // element that holds it is known, so it can be handed back.
    let previous = if field.focused() == Some(true) {
        None
    } else {
        let Some(owner) = field.focus_owner() else {
            return Ok(false);
        };
        // Checked after the probes, which can block, and right before focusing.
        if !field.in_background() {
            return Ok(false);
        }
        // An app the user used while the probes blocked changes nothing.
        check_press()?;
        match field.focus() {
            AXError::Success => {}
            AXError::CannotComplete => unanswered = Some("AXFocused"),
            _ => return Ok(false),
        }
        Some(owner)
    };
    // Focusing can swap in the field editor, so the length is read afterward.
    // The user may bring the app forward while those reads or the selection
    // write block: a borrowed caret is theirs again, and a field the app had
    // focused is theirs to type in, so neither is selected or typed over. Nor
    // does an app the user pressed a key or clicked in.
    let still_borrowed = || {
        (if previous.is_none() {
            !field.brought_forward()
        } else {
            field.in_background()
        }) && check_press().is_ok()
    };
    let selected = unanswered.is_none()
        && field.selectable_length().is_some_and(|length| {
            still_borrowed()
                && match field.select(length) {
                    AXError::Success => still_borrowed(),
                    AXError::CannotComplete => {
                        unanswered = Some("AXSelectedTextRange");
                        false
                    }
                    _ => false,
                }
        });
    if !selected {
        // Nothing was written: hand focus back before the `AXValue` fallback,
        // unless the user has since moved it off the borrowed field.
        if let Some(previous) = previous {
            if field.focused() == Some(true) {
                let error = field.hand_focus_to(&previous);
                if error != AXError::Success {
                    return Err(DesktopError::ax_failed(format!(
                        "focused the field to replace its text, then could not hand focus back \
                         ({error:?}); nothing was written"
                    )));
                }
            }
        }
        check_press()?;
        if let Some(attribute) = unanswered {
            return Err(DesktopError::ax_unconfirmed(format!(
                "setting {attribute} to replace the field's text got no reply in time \
                 (CannotComplete) and may still apply, so nothing was written: observe the window \
                 before retrying"
            )));
        }
        return Ok(false);
    }
    if let Err(error) = field.insert(text) {
        // Whether the insertion was refused, unanswered or read back wrong,
        // the field is the user's again: a borrowed focus goes back unless
        // the user has since moved it off the field; a hand-back the app
        // refuses changes nothing more and the insertion's own verdict stands.
        if let Some(previous) = previous {
            if field.focused() == Some(true) {
                let _ = field.hand_focus_to(&previous);
            }
        }
        return Err(error);
    }
    Ok(true)
}

struct LiveField<'a> {
    element: &'a AXUIElement,
    pid: libc::pid_t,
    /// The app was in the background as the call started (`set_value`).
    may_borrow: bool,
}

impl TextField for LiveField<'_> {
    type Element = CFRetained<AXUIElement>;

    fn focused(&self) -> Option<bool> {
        copy_bool(self.element, "AXFocused")
    }

    fn focus_owner(&self) -> Option<Self::Element> {
        let app = create_application(self.pid).ok()?;
        let _ = set_timeout(&app);
        copy_element(&app, "AXFocusedUIElement")
    }

    fn in_background(&self) -> bool {
        self.may_borrow && may_borrow_focus(current_front_pid(), self.pid)
    }

    fn brought_forward(&self) -> bool {
        self.may_borrow && !may_borrow_focus(current_front_pid(), self.pid)
    }

    fn focus(&self) -> AXError {
        focus_element(self.element)
    }

    fn hand_focus_to(&self, owner: &Self::Element) -> AXError {
        focus_element(owner)
    }

    fn selectable_length(&self) -> Option<isize> {
        if !attribute_settable(self.element, "AXSelectedText")
            || !attribute_settable(self.element, "AXSelectedTextRange")
        {
            return None;
        }
        isize::try_from(copy_string(self.element, "AXValue")?.encode_utf16().count()).ok()
    }

    fn select(&self, length: isize) -> AXError {
        let all = CFRange { location: 0, length };
        // SAFETY: `all` is a live CFRange, the type AXValueCreate is told to copy.
        let Some(range) = (unsafe { AXValue::new(AXValueType::CFRange, std::ptr::NonNull::from(&all).cast()) }) else {
            return AXError::Failure;
        };
        let attribute = CFString::from_str("AXSelectedTextRange");
        // SAFETY: The element, attribute and range stay retained for the setter.
        unsafe { self.element.set_attribute_value(&attribute, &range) }
    }

    fn insert(&self, text: &str) -> CoreResult<()> {
        set_selected_text(self.element, text)?;
        text_readback(text, text, copy_string(self.element, "AXValue").as_deref(), is_secure(self.element))
    }
}

/// Focus moves only inside a background app: in the front app it would move
/// the user's caret, and an unknown front process counts as the target's.
pub(super) fn may_borrow_focus(front: Option<libc::pid_t>, target: libc::pid_t) -> bool {
    front.is_some_and(|front| front != target)
}

/// Sets `AXFocused` on `element`, app-local: it marks nothing sent.
fn focus_element(element: &AXUIElement) -> AXError {
    let attribute = CFString::from_str("AXFocused");
    // SAFETY: The singleton CFBoolean and retained element stay valid for the
    // synchronous setter call.
    unsafe { element.set_attribute_value(&attribute, objc2_core_foundation::CFBoolean::new(true)) }
}
