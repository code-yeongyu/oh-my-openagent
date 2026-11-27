//! XTEST input is foreground input: it lands wherever the server's focus and pointer are, so it is
//! sent only on `Route::ForegroundHid`, which the session posts only while it holds the foreground
//! lease (d-linux.md 'XTEST input'). No other route reaches this file.

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Button;

use super::holds::{HeldButton, HeldKey};
use super::keys::{self, plan, unresolvable, Step};
use super::server::{is_down, FakeInput, InputServer};
use super::{failed, one, root_point, Scratch, X11Input};
use crate::release_helper::Note;

/// Wheel clicks per scroll axis are capped; a larger delta is a caller bug.
const MAX_SCROLL_CLICKS: f64 = 1_000.0;
/// Pixels per wheel click: scroll deltas are pixels on every OS.
const PIXELS_PER_CLICK: f64 = 40.0;
const SHIFT: u32 = 0xffe1;

impl<S: InputServer> X11Input<S> {
    pub(super) fn foreground(&mut self, event: &InputEvent) -> BackendResult<Delivered> {
        let delivered = match event {
            InputEvent::PointerMove(point) => {
                let (x, y) = root_point(*point)?;
                self.fake(FakeInput::Motion { x, y })?;
                one()
            }
            InputEvent::Button { button, down } => self.button(button_detail(*button), *down)?,
            InputEvent::Key { key, down } => self.key(key, *down)?,
            InputEvent::Scroll { dx, dy } => {
                let mut count = 0;
                for (detail, clicks) in scroll_buttons(*dx, *dy) {
                    for _ in 0..clicks {
                        self.fake(FakeInput::Button {
                            detail,
                            press: true,
                        })?;
                        self.fake(FakeInput::Button {
                            detail,
                            press: false,
                        })?;
                        count += 1;
                    }
                }
                Delivered { count, of: count }
            }
            InputEvent::Text(text) => self.type_text(text)?,
            _ => return Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported)),
        };
        self.server.flush().map_err(|error| failed(&error))?;
        Ok(delivered)
    }

    pub(super) fn fake(&self, input: FakeInput) -> Result<(), Refusal> {
        self.server.fake(input).map_err(|error| failed(&error))
    }

    /// A button down records where it went down; its up warps back there first. An up the
    /// engine did not press (the user's button) sends nothing.
    fn button(&mut self, detail: u8, down: bool) -> BackendResult<Delivered> {
        if down {
            let origin = self.server.pointer().map_err(|error| failed(&error))?;
            self.ledger.button_down(HeldButton { detail, origin });
            if let Err(refusal) = self.fake(FakeInput::Button {
                detail,
                press: true,
            }) {
                self.ledger.button_up(detail);
                return Err(refusal);
            }
            return Ok(one());
        }
        let Some(held) = self.ledger.button(detail) else {
            return Ok(Delivered { count: 0, of: 1 });
        };
        let (x, y) = held.origin;
        self.fake(FakeInput::Motion { x, y })?;
        self.fake(FakeInput::Button {
            detail,
            press: false,
        })?;
        self.ledger.button_up(detail);
        Ok(one())
    }

    /// A key down records whether the user held it already; a key up releases only a key the
    /// engine owns, so a user-held key is never released synthetically.
    fn key(&mut self, key: &str, down: bool) -> BackendResult<Delivered> {
        let name = omo_computer_core::keys::key_name(key)
            .map_err(|_| Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey))?;
        let keysym =
            keys::named(&name).ok_or(Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey))?;
        if down {
            self.guard_enter(&name)?;
        }
        let keyboard = self.server.keyboard().map_err(|error| failed(&error))?;
        let (code, _) = keyboard
            .map
            .resolve(keyboard.group, keysym)
            .ok_or_else(|| unresolvable(keyboard.group, &name))?;
        if !down {
            if !self.ledger.engine_holds(code) {
                self.ledger.key_up(code);
                return Ok(Delivered { count: 0, of: 1 });
            }
            self.fake(FakeInput::Key { code, press: false })?;
            self.ledger.key_up(code);
            return Ok(one());
        }
        let user_held = is_down(
            &self.server.keys_down().map_err(|error| failed(&error))?,
            code,
        );
        self.ledger.key_down(HeldKey {
            code,
            user_held,
            transient: false,
        });
        if let Err(refusal) = self.fake(FakeInput::Key { code, press: true }) {
            self.ledger.key_up(code);
            return Err(refusal);
        }
        Ok(one())
    }

    /// Types `text` grapheme by grapheme in the active group. Nothing is sent before the whole
    /// text is planned, and before the first remap the server is asked to take a no-op remap
    /// of the scratch keycode, so a server that refuses remaps answers with nothing sent.
    fn type_text(&mut self, text: &str) -> BackendResult<Delivered> {
        self.guard_enter_text(text)?;
        let keyboard = self.server.keyboard().map_err(|error| failed(&error))?;
        let group = keyboard.group;
        let steps = plan(&keyboard.map, group, text, self.settings.keymap_remap)?;
        let shift = if steps
            .iter()
            .any(|step| matches!(step, Step::Key { shift: true, .. }))
        {
            Some(
                keyboard
                    .map
                    .resolve(group, SHIFT)
                    .ok_or_else(|| unresolvable(group, "shift"))?
                    .0,
            )
        } else {
            None
        };
        if let Some(code) = steps.iter().find_map(|step| match step {
            Step::Remap { code, .. } => Some(*code),
            _ => None,
        }) {
            let original = self
                .server
                .keysyms_of(code)
                .map_err(|error| failed(&error))?;
            let outside = keys::graphemes(text)
                .find(|grapheme| {
                    keys::keysym(grapheme)
                        .and_then(|keysym| keyboard.map.resolve(group, keysym))
                        .is_none()
                })
                .unwrap_or(text);
            self.server
                .remap(code, &original)
                .map_err(|_| unresolvable(group, outside))?;
        }
        let held = self.server.keys_down().map_err(|error| failed(&error))?;
        for step in steps {
            match step {
                Step::Remap { code, keysym } => {
                    let original = self
                        .server
                        .keysyms_of(code)
                        .map_err(|error| failed(&error))?;
                    self.ledger.note(&Note::Remap(code, original.clone()));
                    self.scratch = Some(Scratch { code, original });
                    self.server
                        .remap(code, &[keysym, keysym])
                        .map_err(|error| failed(&error))?;
                }
                Step::Key {
                    code,
                    shift: level_two,
                } => {
                    let shift = shift.filter(|_| level_two);
                    for press in shift.into_iter().chain([code]) {
                        self.ledger.key_down(HeldKey {
                            code: press,
                            user_held: is_down(&held, press),
                            transient: true,
                        });
                        self.fake(FakeInput::Key {
                            code: press,
                            press: true,
                        })?;
                    }
                    for release in [code].into_iter().chain(shift) {
                        if self.ledger.engine_holds(release) {
                            self.fake(FakeInput::Key {
                                code: release,
                                press: false,
                            })?;
                        }
                        self.ledger.key_up(release);
                    }
                }
                Step::Restore { code } => {
                    self.server.flush().map_err(|error| failed(&error))?;
                    if self
                        .scratch
                        .as_ref()
                        .is_some_and(|scratch| scratch.code == code)
                    {
                        self.restore_scratch();
                    }
                }
            }
        }
        let count = u32::try_from(keys::graphemes(text).count()).unwrap_or(u32::MAX);
        Ok(Delivered { count, of: count })
    }
}

pub(crate) const fn button_detail(button: Button) -> u8 {
    match button {
        Button::Left => 1,
        Button::Middle => 2,
        Button::Right => 3,
    }
}

/// Wheel buttons and click counts for pixel deltas: 4/5 up/down, 6/7 left/right, one click per
/// 40 px rounded half up, at least one for any motion, capped at 1000.
pub(crate) fn scroll_buttons(dx: f64, dy: f64) -> Vec<(u8, u32)> {
    [(dy, 4, 5), (dx, 6, 7)]
        .into_iter()
        .filter_map(|(delta, negative, positive)| {
            let pixels = delta.abs();
            if pixels.is_nan() || pixels == 0.0 {
                return None;
            }
            let clicks = (pixels / PIXELS_PER_CLICK + 0.5)
                .floor()
                .clamp(1.0, MAX_SCROLL_CLICKS);
            // Integral and within 1..=1000: the conversion is exact.
            let clicks = clicks as u32;
            Some((if delta < 0.0 { negative } else { positive }, clicks))
        })
        .collect()
}
