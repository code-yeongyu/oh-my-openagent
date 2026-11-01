//! Text typed into one element (`ax.typeText`): AX insertion when the field
//! takes it, else keys once the element holds its application's keyboard
//! focus; keys are never sent unconfirmed (ported from oh-my-pi 0838d2ab44
//! `window_type`, `element_keys`, `keys_after_focus`).

use std::time::{Duration, Instant};

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::CFBoolean;
use objc2_core_foundation::CFString;
use senpi_desktop_core::ax::AxHandle;
use senpi_desktop_core::backend::{DeliveryMode, ElementDelivery, KeyboardFocus};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::intervention::check_press;
use senpi_desktop_core::protocol_results::AxInputMethod;

use super::held::KeyRoute;
use super::{guard, keys, resolve_window, window_identity, MacInput};
use crate::ax::element;
use crate::capture::MacCapture;
use crate::skylight;

/// How long an element given `AXFocused` may take to report itself as its
/// application's focused element before keys addressed to it are refused.
pub(super) const ELEMENT_FOCUS_TIMEOUT: Duration = Duration::from_millis(250);
pub(super) const ELEMENT_FOCUS_POLL: Duration = Duration::from_millis(10);
/// The longest one focus read may block, as a fraction of a second.
const PROBE_TIMEOUT_SECONDS: f32 = 2.0;

impl MacInput {
    /// Types `text` into `element`, an element of a window the capture
    /// lists. Insertion first ([`inserts_first`]); else, in the background,
    /// the window is made key without raising it as window-level keys are,
    /// and the keys go to the process once the element reports focus
    /// ([`element_keys`]); in the foreground the window is raised under the
    /// grant first.
    pub(crate) fn ax_type_text(
        &mut self,
        element: &AXUIElement,
        text: &str,
        mode: DeliveryMode,
        capture: &MacCapture,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<ElementDelivery> {
        let _request = self.held.request();
        let wid = owner_window(element)?;
        let window = resolve_window(capture, &wid.to_string())?;
        let (pid, wid) = window_identity(&window)?;
        // A remote screen shows another device: it takes no insertion, and its
        // text goes out as the keys of the user's layout once the element holds
        // focus (plan todo 22).
        if let Some(remote) = super::remote::remote_screen(pid) {
            return self.type_remote(&window, pid, wid, text, remote, mode, capture, check_stop, delivered, Some(element));
        }
        let insert = || crate::ax::insert_into_element(element, text);
        match mode {
            // Insertion is an AX write like `ax.setValue`: it needs no SkyLight
            // posting, so it runs before the receipt canary; keys run under it.
            DeliveryMode::Background => skylight::reporting_partial(|| {
                if let Some(method) = inserts_first(text, insert)? {
                    report_delivered(text, delivered);
                    return Ok(ElementDelivery::Delivered(method));
                }
                self.background(|this| {
                    guard::guard(&window, "keyboard", None)?;
                    guard::prepare_keys(&window, pid, wid, capture)?;
                    this.last_activated = Some((pid, wid));
                    element_keys(pid, element, || {
                        keys::type_text_interruptible(
                            &this.source,
                            &mut this.held,
                            text,
                            KeyRoute::Process(pid),
                            check_stop,
                            delivered,
                        )
                    })
                })
            }),
            DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                crate::ax::prepare_foreground_input(&window)?;
                if let Some(method) = inserts_first(text, insert)? {
                    report_delivered(text, delivered);
                    return Ok(ElementDelivery::Delivered(method));
                }
                element_keys(pid, element, || {
                    keys::type_text_interruptible(
                        &self.source,
                        &mut self.held,
                        text,
                        KeyRoute::Global,
                        check_stop,
                        delivered,
                    )
                })
            }),
        }
    }
}

/// Every scalar of an inserted text is delivered at once.
fn report_delivered(text: &str, delivered: &mut dyn FnMut()) {
    for _ in text.chars() {
        delivered();
    }
}

/// The id of the window that owns `element`; a destroyed element is a stale
/// ref, an element whose window cannot be named is refused.
fn owner_window(element: &AXUIElement) -> CoreResult<u32> {
    // The role read tells a destroyed element apart from an unmappable one.
    element::copy_held_attribute(element, "AXRole")?;
    element::owner_window_id(element).ok_or_else(|| {
        DesktopError::ax_failed(
            "the window that owns the element cannot be determined, so keys cannot be addressed to it; \
             take a fresh snapshot of its window before typing",
        )
    })
}

/// Whether text was delivered by AX insertion (`insert`) before any key:
/// `Some(Inserted)` when a native field took it at its own selection with no
/// keys and no focus change, `None` when no write was attempted and keys
/// follow. Empty text is done without it: writing `""` to `AXSelectedText`
/// deletes the field's selection.
pub(super) fn inserts_first(
    text: &str,
    insert: impl FnOnce() -> CoreResult<bool>,
) -> CoreResult<Option<AxInputMethod>> {
    if text.is_empty() {
        return Ok(Some(AxInputMethod::Inserted));
    }
    Ok(insert()?.then_some(AxInputMethod::Inserted))
}

/// Focuses `element` and runs `send` only once `pid` reports it as its
/// focused element within [`ELEMENT_FOCUS_TIMEOUT`], read every
/// [`ELEMENT_FOCUS_POLL`] ([`keys_after_focus`]); nothing is focused once the
/// user has pressed a key or clicked in the app since the call was admitted
/// ([`check_press`]).
pub(super) fn element_keys(
    pid: libc::pid_t,
    element: &AXUIElement,
    send: impl FnOnce() -> CoreResult<()>,
) -> CoreResult<ElementDelivery> {
    check_press()?;
    let deadline = Instant::now() + ELEMENT_FOCUS_TIMEOUT;
    keys_after_focus(
        || set_focused(element),
        || deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero()),
        |left| holds_keyboard_focus(pid, element, left),
        |left| {
            std::thread::sleep(ELEMENT_FOCUS_POLL.min(left));
            Ok(())
        },
        || keyboard_focus(pid),
        send,
    )
}

/// Keys addressed to an element: `focus` gives it keyboard focus, and `send`
/// runs once `holds_focus` reports that it has it, read again after each
/// `wait` while `remaining` time is left; when it never does, nothing is sent
/// and `unfocused` reads where focus is instead.
///
/// A focus setter the element refuses does not end the call on its own: the
/// read decides, so the refusal names where focus is; only a destroyed
/// element stops at once. Each read is bounded by the time left, and a read
/// that returns after the deadline counts as unconfirmed. Focus is confirmed
/// once, before the first key: a field that moves focus to the next one as
/// each character lands, as split code inputs do, keeps receiving the rest.
pub(super) fn keys_after_focus(
    focus: impl FnOnce() -> CoreResult<()>,
    mut remaining: impl FnMut() -> Option<Duration>,
    mut holds_focus: impl FnMut(Duration) -> bool,
    mut wait: impl FnMut(Duration) -> CoreResult<()>,
    unfocused: impl FnOnce() -> KeyboardFocus,
    send: impl FnOnce() -> CoreResult<()>,
) -> CoreResult<ElementDelivery> {
    if let Err(error) = focus() {
        if error.code == ErrorCode::StaleRef {
            return Err(error);
        }
    }
    loop {
        let Some(left) = remaining() else {
            return Ok(ElementDelivery::Unfocused(unfocused()));
        };
        let held = holds_focus(left);
        let Some(left) = remaining() else {
            return Ok(ElementDelivery::Unfocused(unfocused()));
        };
        if held {
            send()?;
            return Ok(ElementDelivery::Delivered(AxInputMethod::Keys));
        }
        wait(left)?;
    }
}

/// Sets `AXFocused` on `element` to prepare keys: app-local, so it marks
/// nothing sent; a destroyed element is a stale ref, a refusal is reported
/// as failed for [`keys_after_focus`] to decide on.
fn set_focused(element: &AXUIElement) -> CoreResult<()> {
    let attribute = CFString::from_str("AXFocused");
    // SAFETY: The singleton CFBoolean and retained element stay valid for the
    // synchronous setter call.
    match unsafe { element.set_attribute_value(&attribute, CFBoolean::new(true)) } {
        AXError::Success => Ok(()),
        AXError::InvalidUIElement => Err(DesktopError::stale_ref("the element no longer exists; re-run ax()/find()")),
        error => Err(DesktopError::ax_failed(format!("setting AXFocused=true failed ({error:?})"))),
    }
}

/// Whether `pid` reports `element` as its `AXFocusedUIElement`, waiting at
/// most `within` for the application's reply.
fn holds_keyboard_focus(pid: libc::pid_t, element: &AXUIElement, within: Duration) -> bool {
    let Ok(app) = element::create_application(pid) else {
        return false;
    };
    // A zero timeout restores the system default, so the bound stays positive.
    let timeout = within.as_secs_f32().clamp(0.001, PROBE_TIMEOUT_SECONDS);
    // SAFETY: The retained application element is valid for the timeout update.
    let _ = unsafe { app.set_messaging_timeout(timeout) };
    element::copy_element(&app, "AXFocusedUIElement").is_some_and(|focused| *focused == *element)
}

/// Where `pid` has keyboard focus now: its focused window, else the window
/// its focused element maps to, and that element.
fn keyboard_focus(pid: libc::pid_t) -> KeyboardFocus {
    let Ok(app) = element::create_application(pid) else {
        return KeyboardFocus::default();
    };
    let _ = element::set_timeout(&app);
    let focused = element::copy_element(&app, "AXFocusedUIElement");
    let window = element::copy_element(&app, "AXFocusedWindow")
        .and_then(|window| element::window_id(&window))
        .or_else(|| focused.as_deref().and_then(element::owner_window_id));
    KeyboardFocus {
        window: window.map(|id| id.to_string()),
        element: focused.map(AxHandle::native),
    }
}
