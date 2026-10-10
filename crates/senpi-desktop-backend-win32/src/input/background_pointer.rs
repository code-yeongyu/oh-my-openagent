use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::Foundation::{LPARAM, POINT, WPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_NCHITTEST,
};

use super::background::{post, refusal};
use super::dispatch::{to_physical, Via, Win32Input};
use super::held::{HeldButton, Route};
use super::keys::modifier_virtual_keys;
use super::messages::{
    button_messages, modifier_flags, packed_point, scroll_steps, wheel_wparam, WHEEL_DELTA,
    WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL,
};
use super::native::Window;
use crate::ax::Win32Ax;
use crate::delivery::{
    is_chromium_class, non_client_drag_region, posts_double_click, EventKind,
};

fn screen_point(x: f64, y: f64) -> CoreResult<POINT> {
    let (x, y) = to_physical(x, y)?;
    Ok(POINT { x, y })
}

fn child_at(root: Window, x: f64, y: f64) -> CoreResult<(Window, LPARAM)> {
    let (child, point) = root.deepest_child(screen_point(x, y)?).ok_or_else(|| {
        DesktopError::background_unavailable(
            "cannot map this point into an enabled target client area; use ax actions or delivery:\"foreground\"",
        )
    })?;
    Ok((child, packed_point(point.x, point.y)?))
}

fn client_point(window: Window, x: f64, y: f64) -> CoreResult<LPARAM> {
    let point = window.client_point(screen_point(x, y)?).ok_or_else(|| {
        DesktopError::input_failed("cannot map physical coordinates to the target window's DPI")
    })?;
    packed_point(point.x, point.y)
}

fn hit_test(root: Window, point: POINT) -> Option<isize> {
    let location = root.logical_screen_point(point)?;
    let location = packed_point(location.x, location.y).ok()?;
    let mut hit = 0;
    // SAFETY: [Category 8 - FFI boundary] all message parameters are scalar,
    // `hit` is writable, and the timeout bounds an unresponsive target.
    let answered = unsafe {
        SendMessageTimeoutW(
            root.hwnd(),
            WM_NCHITTEST,
            0,
            location,
            SMTO_ABORTIFHUNG,
            200,
            &mut hit,
        )
    } != 0;
    answered.then(|| isize::try_from(hit).unwrap_or(isize::MAX))
}

struct ButtonPost {
    button: MouseButton,
    at: LPARAM,
    message: u32,
    key_state: WPARAM,
}

impl Win32Input {
    pub(super) fn post_pointer(
        &mut self,
        ax: &mut Win32Ax,
        id: &str,
        event: &PointerEvent,
    ) -> CoreResult<()> {
        let kind = match event {
            PointerEvent::Click { .. } => EventKind::MouseClick,
            PointerEvent::Move { .. } | PointerEvent::Drag { .. } => EventKind::MouseMove,
            PointerEvent::Scroll { .. } => EventKind::MouseScroll,
        };
        let root = Window::target(id, self.integrity)?;
        if let Some(error) = refusal(id, root, kind) {
            let fallback = if let PointerEvent::Click {
                x,
                y,
                button: MouseButton::Left,
                count: 1,
                modifiers,
            } = event
            {
                *modifiers == Default::default()
                    && !is_chromium_class(&root.class_name())
                    && ax.invoke_at_point(root.hwnd(), screen_point(*x, *y)?)?
            } else {
                false
            };
            if fallback {
                return Ok(());
            }
            return Err(error);
        }
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                let (window, at) = child_at(root, *x, *y)?;
                refusal(id, window, kind).map_or(Ok(()), Err)?;
                let messages = button_messages(*button);
                let flags = modifier_flags(*modifiers);
                let wants_double = window.class_wants_double_clicks();
                self.holding(Via::Post(window), &modifier_virtual_keys(*modifiers), |this| {
                    for index in 0..*count {
                        let down = if posts_double_click(index, wants_double) {
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
            PointerEvent::Move { x, y } => {
                let (window, point) = child_at(root, *x, *y)?;
                refusal(id, window, kind).map_or(Ok(()), Err)?;
                post(window, WM_MOUSEMOVE, 0, point)
            }
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let (Some(&(first_x, first_y)), Some(&(last_x, last_y))) =
                    (path.first(), path.last())
                else {
                    return Err(DesktopError::input_failed("drag path is empty"));
                };
                let start_screen = screen_point(first_x, first_y)?;
                let hit = hit_test(root, start_screen).ok_or_else(|| {
                    DesktopError::background_unavailable(
                        "cannot establish the drag start region; use ax actions or delivery:\"foreground\"",
                    )
                })?;
                if let Some(region) = non_client_drag_region(hit) {
                    return Err(DesktopError::background_unavailable(format!(
                        "window {id} drag starts on its {region}, where posted input cannot drive the system move/size loop; retry with delivery:\"foreground\" or use ax actions"
                    )));
                }
                let (window, start_point) =
                    root.deepest_child(start_screen).ok_or_else(|| {
                        DesktopError::background_unavailable(
                            "cannot map the drag start into an enabled target client area",
                        )
                    })?;
                refusal(id, window, kind).map_or(Ok(()), Err)?;
                let messages = button_messages(*button);
                let flags = modifier_flags(*modifiers);
                self.holding(Via::Post(window), &modifier_virtual_keys(*modifiers), |this| {
                    let start = packed_point(start_point.x, start_point.y)?;
                    post(window, WM_MOUSEMOVE, flags, start)?;
                    this.post_button(
                        window,
                        ButtonPost {
                            button: *button,
                            at: start,
                            message: messages.down,
                            key_state: flags | messages.flag,
                        },
                    )?;
                    let movement = path.iter().skip(1).try_for_each(|&(x, y)| {
                        post(
                            window,
                            WM_MOUSEMOVE,
                            flags | messages.flag,
                            client_point(window, x, y)?,
                        )
                    });
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
                let point = screen_point(*x, *y)?;
                let (window, _) = root.deepest_child(point).ok_or_else(|| {
                    DesktopError::background_unavailable(
                        "cannot map this point into an enabled target client area",
                    )
                })?;
                refusal(id, window, kind).map_or(Ok(()), Err)?;
                let logical = window.logical_screen_point(point).ok_or_else(|| {
                    DesktopError::input_failed("cannot map wheel coordinates to the target's DPI")
                })?;
                let location = packed_point(logical.x, logical.y)?;
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
            self.held.button_down(HeldButton {
                route,
                button,
                at,
            });
        }
        Ok(())
    }
}
