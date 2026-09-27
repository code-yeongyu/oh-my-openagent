//! Background delivery: `PostMessageW` straight into the target window's
//! queue (oh-my-pi `win32/input.rs:184-560`), gated by the toolkit class
//! matrix so a toolkit that ignores posted input yields
//! `BackgroundUnavailable` instead of a silent no-op. The foreground and the
//! cursor are never touched.

use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use windows_sys::Win32::Foundation::{LPARAM, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
use windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW;

use super::dispatch::{to_physical, utf16_units, Via, Win32Input};
use super::held::{HeldButton, Route};
use super::keys::{key_message, modifier_virtual_keys};
use super::messages::{
    button_messages, modifier_flags, packed_point, scroll_steps, wheel_wparam, WHEEL_DELTA, WM_CHAR,
    WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL,
};
use super::native::{self, Window};
use crate::delivery::{background_refusal, EventKind};
use crate::integrity::IntegrityRid;

/// The window `id` after the UIPI check and the class matrix for `kind`.
fn deliverable(id: &str, own: IntegrityRid, kind: EventKind) -> CoreResult<Window> {
    let window = Window::target(id, own)?;
    match background_refusal(id, &window.class_name(), kind) {
        Some(refusal) => Err(refusal),
        None => Ok(window),
    }
}

/// The window a background key chord of `keys` is posted to: the target's
/// keyboard focus, after the matrix accepted the target's own class.
pub(super) fn key_target(id: &str, own: IntegrityRid, keys: &[KeyName]) -> CoreResult<Window> {
    let kind = if keys.len() > 1 || keys.iter().any(|key| key.is_modifier()) {
        EventKind::KeyCombo
    } else {
        EventKind::Keystroke
    };
    deliverable(id, own, kind).map(Window::keyboard_focus)
}

fn post(window: Window, message: u32, wparam: WPARAM, lparam: LPARAM) -> CoreResult<()> {
    // SAFETY: [FFI] Win32 copies these scalar message parameters into the
    // target's queue and retains no borrowed memory; a stale HWND fails.
    if unsafe { PostMessageW(window.hwnd(), message, wparam, lparam) } != 0 {
        return Ok(());
    }
    Err(DesktopError::input_failed(format!(
        "PostMessageW failed: {}",
        std::io::Error::last_os_error()
    )))
}

pub(super) fn post_key(window: Window, vk: u16, down: bool, alt_down: bool) -> CoreResult<()> {
    let (message, lparam) = key_message(vk, native::scan_code(vk), down, alt_down);
    post(window, message, usize::from(vk), lparam)
}

pub(super) fn post_button_up(window: Window, held: HeldButton) -> CoreResult<()> {
    post(window, button_messages(held.button).up, 0, held.at)
}

pub(super) fn post_text(id: &str, own: IntegrityRid, text: &str) -> CoreResult<()> {
    let window = deliverable(id, own, EventKind::TextInput)?.keyboard_focus();
    utf16_units(text).try_for_each(|unit| post(window, WM_CHAR, usize::from(unit), 1))
}

/// A global logical point as a client-area `lParam` of `window`.
fn client_point(window: Window, x: f64, y: f64) -> CoreResult<LPARAM> {
    let (x, y) = to_physical(x, y)?;
    let mut point = POINT { x, y };
    // SAFETY: [FFI] `point` is a valid in/out slot; a stale HWND fails.
    if unsafe { ScreenToClient(window.hwnd(), &raw mut point) } == 0 {
        return Err(DesktopError::input_failed(
            "ScreenToClient failed for target window",
        ));
    }
    packed_point(point.x, point.y)
}

/// One posted button message: a down, double-click, or up message of
/// `button` at client point `at`, with its `MK_*` key state.
struct ButtonPost {
    button: MouseButton,
    at: LPARAM,
    message: u32,
    key_state: WPARAM,
}

impl Win32Input {
    pub(super) fn post_pointer(&mut self, id: &str, event: &PointerEvent) -> CoreResult<()> {
        let kind = match event {
            PointerEvent::Click { .. } => EventKind::MouseClick,
            PointerEvent::Move { .. } | PointerEvent::Drag { .. } => EventKind::MouseMove,
            PointerEvent::Scroll { .. } => EventKind::MouseScroll,
        };
        let window = deliverable(id, self.integrity, kind)?;
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                let at = client_point(window, *x, *y)?;
                let messages = button_messages(*button);
                let flags = modifier_flags(*modifiers);
                self.holding(Via::Post(window), &modifier_virtual_keys(*modifiers), |this| {
                    for index in 0..*count {
                        let down = if index == 1 {
                            messages.double
                        } else {
                            messages.down
                        };
                        this.post_button(
                            window,
                            ButtonPost {
                                button: *button,
                                at,
                                message: down,
                                key_state: flags | messages.flag,
                            },
                        )?;
                        this.post_button(
                            window,
                            ButtonPost {
                                button: *button,
                                at,
                                message: messages.up,
                                key_state: flags,
                            },
                        )?;
                    }
                    Ok(())
                })
            }
            PointerEvent::Move { x, y } => post(window, WM_MOUSEMOVE, 0, client_point(window, *x, *y)?),
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let (Some(&(first_x, first_y)), Some(&(last_x, last_y))) = (path.first(), path.last()) else {
                    return Err(DesktopError::input_failed("drag path is empty"));
                };
                let messages = button_messages(*button);
                let flags = modifier_flags(*modifiers);
                self.holding(Via::Post(window), &modifier_virtual_keys(*modifiers), |this| {
                    let start = client_point(window, first_x, first_y)?;
                    post(window, WM_MOUSEMOVE, flags, start)?;
                    let press = ButtonPost {
                        button: *button,
                        at: start,
                        message: messages.down,
                        key_state: flags | messages.flag,
                    };
                    this.post_button(window, press)?;
                    let movement = path.iter().skip(1).try_for_each(|&(x, y)| {
                        post(
                            window,
                            WM_MOUSEMOVE,
                            flags | messages.flag,
                            client_point(window, x, y)?,
                        )
                    });
                    // The button goes up even when the end point cannot be
                    // mapped: at the start point, and the mapping error wins.
                    let end = client_point(window, last_x, last_y);
                    let at = *end.as_ref().unwrap_or(&start);
                    let release = this.post_button(
                        window,
                        ButtonPost {
                            button: *button,
                            at,
                            message: messages.up,
                            key_state: flags,
                        },
                    );
                    movement.and(end.map(drop)).and(release)
                })
            }
            PointerEvent::Scroll { x, y, dx, dy } => {
                let (x, y) = to_physical(*x, *y)?;
                let location = packed_point(x, y)?;
                let horizontal = scroll_steps(*dx).saturating_mul(WHEEL_DELTA);
                let vertical = scroll_steps(*dy).saturating_mul(-WHEEL_DELTA);
                if horizontal != 0 {
                    post(window, WM_MOUSEHWHEEL, wheel_wparam(horizontal)?, location)?;
                }
                if vertical != 0 {
                    post(window, WM_MOUSEWHEEL, wheel_wparam(vertical)?, location)?;
                }
                Ok(())
            }
        }
    }

    /// Posts one button message and records the transition in the ledger.
    fn post_button(&mut self, window: Window, message: ButtonPost) -> CoreResult<()> {
        let ButtonPost {
            button,
            at,
            message,
            key_state,
        } = message;
        post(window, message, key_state, at)?;
        let route = Route::Window(window.address());
        if message == button_messages(button).up {
            self.held.button_up(route, button);
        } else {
            self.held.button_down(HeldButton { route, button, at });
        }
        Ok(())
    }
}
