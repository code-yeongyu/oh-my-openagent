//! Pointer input on the system input queue (`SendInput`), shared by the
//! desktop and the foreground routes. enigo's absolute move normalizes
//! against the primary monitor only (`SM_CXSCREEN`), so every move goes
//! through the virtual-desktop `SendInput` path instead.

use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::dispatch::{to_physical, Via, Win32Input};
use super::held::{HeldButton, Route};
use super::keys::modifier_virtual_keys;
use super::messages::{scroll_steps, WHEEL_DELTA};
use super::system;

impl Win32Input {
    pub(super) fn system_pointer(&mut self, event: &PointerEvent) -> CoreResult<()> {
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                system::move_to(to_physical(*x, *y)?)?;
                self.holding(Via::SendInput, &modifier_virtual_keys(*modifiers), |this| {
                    for _ in 0..*count {
                        this.system_button(*button, true)?;
                        this.system_button(*button, false)?;
                    }
                    Ok(())
                })
            }
            PointerEvent::Move { x, y } => system::move_to(to_physical(*x, *y)?),
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let Some(&(x, y)) = path.first() else {
                    return Err(DesktopError::input_failed("drag path is empty"));
                };
                system::move_to(to_physical(x, y)?)?;
                self.holding(Via::SendInput, &modifier_virtual_keys(*modifiers), |this| {
                    this.system_button(*button, true)?;
                    let movement = path
                        .iter()
                        .skip(1)
                        .try_for_each(|&(x, y)| system::move_to(to_physical(x, y)?));
                    let release = this.system_button(*button, false);
                    movement.and(release)
                })
            }
            PointerEvent::Scroll { x, y, dx, dy } => {
                system::move_to(to_physical(*x, *y)?)?;
                let horizontal = scroll_steps(*dx).saturating_mul(WHEEL_DELTA);
                let vertical = scroll_steps(*dy).saturating_mul(-WHEEL_DELTA);
                if horizontal != 0 {
                    system::wheel(true, horizontal)?;
                }
                if vertical != 0 {
                    system::wheel(false, vertical)?;
                }
                Ok(())
            }
        }
    }

    /// One button transition, recorded in the ledger once delivered.
    fn system_button(&mut self, button: MouseButton, down: bool) -> CoreResult<()> {
        system::button(button, down)?;
        if down {
            self.held.button_down(HeldButton {
                route: Route::System,
                button,
                at: 0,
            });
        } else {
            self.held.button_up(Route::System, button);
        }
        Ok(())
    }
}
