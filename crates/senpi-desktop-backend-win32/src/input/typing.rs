//! Text input: one foreground focus guard for the entire request, with
//! interruption between complete Unicode scalars.

use enigo::Keyboard;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::Target;

use super::dispatch::{enigo_error, Via, Win32Input};
use super::keys::VK_RETURN;
use super::native::Window;
use super::typing_progress::run_text_steps;
use super::{background, system};
use crate::delivery::{text_units, TextUnit};

impl Win32Input {
    pub(crate) fn type_text(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        match (target, mode) {
            (Target::Desktop, _) => self.enigo.text(text).map_err(enigo_error),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |input, target| {
                    text_units(text).try_for_each(|unit| foreground_unit(input, unit, target))
                })
            }
            (Target::Window(id), DeliveryMode::Background) => {
                background::post_text(id, self.integrity, text)
            }
        }
    }

    pub(crate) fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        match (target, mode) {
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |input, target| {
                    run_text_steps(
                        text,
                        check_stop,
                        |unit| foreground_unit(input, unit, target),
                        delivered,
                    )
                })
            }
            (Target::Window(id), DeliveryMode::Background) => run_text_steps(
                text,
                check_stop,
                |unit| {
                    let mut encoded = [0; 4];
                    let text = match unit {
                        TextUnit::Enter => "\n",
                        TextUnit::Char(character) => character.encode_utf8(&mut encoded),
                    };
                    background::post_text(id, self.integrity, text)
                },
                delivered,
            ),
            (Target::Desktop, _) => {
                for character in text.chars() {
                    check_stop()?;
                    self.enigo
                        .text(&character.to_string())
                        .map_err(enigo_error)?;
                    delivered();
                }
                Ok(())
            }
        }
    }
}

fn foreground_unit(input: &mut Win32Input, unit: TextUnit, target: Window) -> CoreResult<()> {
    match unit {
        TextUnit::Enter => {
            input.holding(Via::SendInput(Some(target)), &[VK_RETURN], |_| Ok(()))
        }
        TextUnit::Char(character) => {
            let mut units = [0; 2];
            system::unicode_text(
                character.encode_utf16(&mut units).iter().copied(),
                Some(target),
            )
        }
    }
}
