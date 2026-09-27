//! `Win32Input`: routes every input by target and delivery mode, and keeps
//! the held-state ledger `release_all` replays.
//!
//! - `Target::Desktop`: enigo for keys and text, `SendInput` for the pointer.
//! - `Target::Window` + foreground: the `SetForegroundWindow` focus guard
//!   around `SendInput`.
//! - `Target::Window` + background: `PostMessageW` when the toolkit class
//!   matrix accepts the event, else `BackgroundUnavailable` - never a silent
//!   fallback to the foreground.
//!
//! Every window-targeted input first refuses an elevated window (UIPI).

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopPoint, Target};

use super::held::{Held, HeldKey, Route};
use super::keys::{chord_virtual_keys, named_virtual_key, Stroke, VK_MENU};
use super::native::{self, Window};
use super::{background, system};
use crate::capture::{all_displays, logical_bounds, physical_point, PhysicalRect};
use crate::integrity::IntegrityRid;

/// How one key transition is delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Via {
    Enigo,
    SendInput,
    Post(Window),
}

impl Via {
    const fn route(self) -> Route {
        match self {
            Self::Enigo | Self::SendInput => Route::System,
            Self::Post(window) => Route::Window(window.address()),
        }
    }
}

pub(crate) struct Win32Input {
    pub(super) enigo: Enigo,
    pub(super) held: Held,
    pub(super) integrity: IntegrityRid,
}

impl Win32Input {
    /// # Errors
    /// `InputFailed` when enigo cannot initialize.
    pub(crate) fn new(integrity: IntegrityRid) -> CoreResult<Self> {
        let settings = Settings {
            open_prompt_to_get_permissions: false,
            ..Settings::default()
        };
        let enigo = Enigo::new(&settings).map_err(|error| {
            DesktopError::input_failed(format!("Win32 input initialization failed: {error}"))
        })?;
        Ok(Self {
            enigo,
            held: Held::default(),
            integrity,
        })
    }

    pub(crate) fn pointer(
        &mut self,
        target: &Target,
        event: &PointerEvent,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        match (target, mode) {
            (Target::Desktop, _) => self.system_pointer(event),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |this| this.system_pointer(event))
            }
            (Target::Window(id), DeliveryMode::Background) => self.post_pointer(id, event),
        }
    }

    pub(crate) fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        match (target, mode) {
            (Target::Desktop, _) => self.enigo.text(text).map_err(enigo_error),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |_| system::unicode_text(utf16_units(text)))
            }
            (Target::Window(id), DeliveryMode::Background) => background::post_text(id, self.integrity, text),
        }
    }

    pub(crate) fn key_chord(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        if keys.is_empty() {
            return Err(DesktopError::input_failed("key chord is empty"));
        }
        let strokes = keys
            .iter()
            .map(|&key| named_virtual_key(key).map_or_else(|| char_stroke(key), |vk| Ok(Stroke::plain(vk))))
            .collect::<CoreResult<Vec<_>>>()?;
        let vks = chord_virtual_keys(&strokes);
        match (target, mode) {
            (Target::Desktop, _) => self.holding(Via::Enigo, &vks, |_| Ok(())),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |this| this.holding(Via::SendInput, &vks, |_| Ok(())))
            }
            (Target::Window(id), DeliveryMode::Background) => {
                let window = background::key_target(id, self.integrity, keys)?;
                self.holding(Via::Post(window), &vks, |_| Ok(()))
            }
        }
    }

    /// Presses `vks` in order, runs `body`, and releases them in reverse. A
    /// failed press skips `body` but still releases what went down; the first
    /// error wins, and a key whose release failed stays in the ledger.
    pub(super) fn holding(
        &mut self,
        via: Via,
        vks: &[u16],
        body: impl FnOnce(&mut Self) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let mut pressed = 0;
        let mut result = Ok(());
        for &vk in vks {
            if let Err(error) = self.transition(via, vk, true) {
                result = Err(error);
                break;
            }
            pressed += 1;
        }
        if result.is_ok() {
            result = body(self);
        }
        for &vk in vks[..pressed].iter().rev() {
            let released = self.transition(via, vk, false);
            result = result.and(released);
        }
        result
    }

    /// One key transition, recorded in the ledger once it was delivered.
    fn transition(&mut self, via: Via, vk: u16, down: bool) -> CoreResult<()> {
        let held = HeldKey {
            route: via.route(),
            vk,
        };
        match via {
            Via::Enigo => {
                let direction = if down {
                    Direction::Press
                } else {
                    Direction::Release
                };
                self.enigo
                    .key(Key::Other(u32::from(vk)), direction)
                    .map_err(enigo_error)?;
            }
            Via::SendInput => system::key(vk, down)?,
            Via::Post(window) => {
                let alt_down = self
                    .held
                    .keys()
                    .iter()
                    .any(|key| key.route == held.route && key.vk == VK_MENU);
                background::post_key(window, vk, down, alt_down)?;
            }
        }
        if down {
            self.held.key_down(held);
        } else {
            self.held.key_up(held);
        }
        Ok(())
    }

    /// Releases every key and button still held, on the route it went down
    /// on; keeps going past a failure and reports the first one. A posted
    /// press whose window has closed is dropped from the ledger.
    pub(crate) fn release_all(&mut self) -> CoreResult<()> {
        let mut result = Ok(());
        for held in self.held.buttons() {
            let released = match held.route {
                Route::System => system::button(held.button, false),
                Route::Window(address) if !Window(address).is_live() => Ok(()),
                Route::Window(address) => background::post_button_up(Window(address), held),
            };
            if released.is_ok() {
                self.held.button_up(held.route, held.button);
            }
            result = result.and(released);
        }
        for held in self.held.keys() {
            let via = match held.route {
                Route::System => Via::SendInput,
                Route::Window(address) if !Window(address).is_live() => {
                    self.held.key_up(held);
                    continue;
                }
                Route::Window(address) => Via::Post(Window(address)),
            };
            result = result.and(self.transition(via, held.vk, false));
        }
        result
    }
}

/// The cursor in global logical coordinates.
pub(crate) fn cursor_position() -> CoreResult<DesktopPoint> {
    let (x, y) = native::cursor()?;
    let bounds = logical_bounds(
        PhysicalRect {
            x,
            y,
            width: 1,
            height: 1,
        },
        &all_displays()?,
    );
    Ok(DesktopPoint {
        x: bounds.x,
        y: bounds.y,
    })
}

/// Moves the cursor to a global logical point without input.
pub(crate) fn warp_cursor(point: DesktopPoint) -> CoreResult<()> {
    let (x, y) = to_physical(point.x, point.y)?;
    native::set_cursor(x, y)
}

/// A global logical point in physical virtual-desktop pixels.
pub(super) fn to_physical(x: f64, y: f64) -> CoreResult<(i32, i32)> {
    physical_point(x, y, &all_displays()?)
        .ok_or_else(|| DesktopError::input_failed("Win32 reported no displays to map the point onto"))
}

fn char_stroke(key: KeyName) -> CoreResult<Stroke> {
    match key {
        KeyName::Char(character) => native::layout_stroke(character),
        named => Err(DesktopError::invalid_key(format!(
            "{named:?} has no Win32 virtual key"
        ))),
    }
}

/// The UTF-16 units of `text` as typed: a newline is Enter's carriage return.
pub(super) fn utf16_units(text: &str) -> impl Iterator<Item = u16> + '_ {
    text.chars().flat_map(|character| {
        let character = if character == '\n' { '\r' } else { character };
        let mut units = [0u16; 2];
        let count = character.encode_utf16(&mut units).len();
        units.into_iter().take(count)
    })
}

fn enigo_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::input_failed(format!("Win32 global input failed: {error}"))
}
