//! The keys and buttons the user physically holds, and how an event changes
//! them. Ported from oh-my-pi `desktop/macos/release.rs` (MIT).

use super::wire::Input;

/// A set of keys and buttons.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Inputs {
    keys: u128,
    buttons: u32,
}

impl Inputs {
    fn set(&mut self, input: Input, down: bool) {
        match input {
            Input::Key(code) if code < 128 => {
                let bit = 1u128 << code;
                self.keys = if down { self.keys | bit } else { self.keys & !bit };
            }
            Input::Button(number) if number < 32 => {
                let bit = 1u32 << number;
                self.buttons = if down { self.buttons | bit } else { self.buttons & !bit };
            }
            Input::Key(_) | Input::Button(_) => {}
        }
    }

    const fn has(self, input: Input) -> bool {
        match input {
            Input::Key(code) => code < 128 && self.keys & (1 << code) != 0,
            Input::Button(number) => number < 32 && self.buttons & (1 << number) != 0,
        }
    }
}

/// The keys and buttons the user physically holds on the HID route.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct UserHolds {
    held: Inputs,
    /// Holds read back from the HID state after the tap missed events
    /// ([`Self::resync`]): they may be this request's own presses until their
    /// next transition says.
    unsure: Inputs,
}

impl UserHolds {
    /// Applies a transition of the user's own.
    pub(crate) fn set(&mut self, input: Input, down: bool) {
        self.held.set(input, down);
        self.unsure.set(input, false);
    }

    /// Adds every hold of `down` as the user's own.
    pub(crate) const fn hold_all(&mut self, down: Self) {
        self.held.keys |= down.held.keys;
        self.held.buttons |= down.held.buttons;
    }

    /// A process posted the release of `input`: an unsure hold of it was
    /// that process's press.
    pub(crate) fn posted_release(&mut self, input: Input) {
        if self.unsure.has(input) {
            self.held.set(input, false);
            self.unsure.set(input, false);
        }
    }

    /// Takes the HID state after the tap missed events: every key and button
    /// down counts as the user's, unsure until its next transition, since a
    /// press of this request may hold it.
    pub(crate) const fn resync(&mut self, down: Self) {
        self.held = down.held;
        self.unsure = down.held;
    }

    /// The holds a release plan trusts: an unsure hold of an input this
    /// request pressed on the HID route is taken for that press, so it is
    /// released rather than left down.
    pub(crate) fn for_plan(mut self, hid_presses: impl Iterator<Item = Input>) -> Self {
        for input in hid_presses {
            if self.unsure.has(input) {
                self.held.set(input, false);
            }
        }
        self.unsure = Inputs::default();
        self
    }

    /// Whether the user holds `input`, or for a modifier, the same modifier
    /// on either side: both sides share one modifier flag.
    pub(crate) fn holds(self, input: Input) -> bool {
        match input_modifier(input) {
            Some((_, sides)) => sides.iter().any(|&(code, _)| self.has(Input::Key(code))),
            None => self.has(input),
        }
    }

    /// Whether the user holds exactly `input`.
    pub(crate) const fn has(self, input: Input) -> bool {
        self.held.has(input)
    }

    /// The device-independent flags of the modifiers the user holds.
    pub(crate) fn flags(self) -> u64 {
        MODIFIERS
            .iter()
            .filter(|(_, sides)| sides.iter().any(|&(code, _)| self.has(Input::Key(code))))
            .fold(0, |flags, (flag, _)| flags | flag)
    }
}

/// Device-independent flag, and the left and right virtual key codes with
/// their device-dependent flags, of each modifier a held key can carry.
const MODIFIERS: [(u64, [(u16, u64); 2]); 4] = [
    (0x40000, [(59, 0x1), (62, 0x2000)]), // control
    (0x80000, [(58, 0x20), (61, 0x40)]),  // option
    (0x20000, [(56, 0x2), (60, 0x4)]),    // shift
    (0x10_0000, [(55, 0x8), (54, 0x10)]), // command
];
/// Every device-dependent modifier flag: hardware sets them, the engine never
/// does.
const DEVICE_FLAGS: u64 = 0x207f;

pub(crate) fn modifier(code: u16) -> Option<(u64, [(u16, u64); 2])> {
    MODIFIERS
        .into_iter()
        .find(|(_, sides)| sides.iter().any(|&(side, _)| side == code))
}

fn input_modifier(input: Input) -> Option<(u64, [(u16, u64); 2])> {
    match input {
        Input::Key(code) => modifier(code),
        Input::Button(_) => None,
    }
}

const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const FLAGS_CHANGED: u32 = 12;
/// Down, up and dragged event types of the left, right and other buttons.
const BUTTON_EVENTS: [[u32; 3]; 3] = [[1, 2, 6], [3, 4, 7], [25, 26, 27]];
/// Every key and button event type [`transition`] reads.
pub(crate) const TRANSITION_TYPES: [u32; 12] = [1, 2, 3, 4, 6, 7, 10, 11, 12, 25, 26, 27];

/// What an event does to the key or button it carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Transition {
    Press(Input),
    Release(Input),
    /// A held button moved: a drag.
    Move(Input),
}

/// The transition of an event of type `kind` with key code `code`, `flags`
/// and button number `button`. A modifier event says which way it went
/// through its flags: hardware sets each side's device-dependent flag, a
/// process only the shared one, and without either the modifier is up. A key
/// with no modifier flag of its own, such as Caps Lock, toggles what `held`
/// reports for it.
pub(crate) fn transition(
    kind: u32,
    code: u16,
    flags: u64,
    button: i64,
    held: impl FnOnce(Input) -> bool,
) -> Option<Transition> {
    for (number, [down, up, dragged]) in (0u8..).zip(BUTTON_EVENTS) {
        let input = Input::Button(if number < 2 { number } else { u8::try_from(button).unwrap_or(u8::MAX) });
        if kind == down {
            return Some(Transition::Press(input));
        }
        if kind == up {
            return Some(Transition::Release(input));
        }
        if kind == dragged {
            return Some(Transition::Move(input));
        }
    }
    let key = Input::Key(code);
    match kind {
        KEY_DOWN => Some(Transition::Press(key)),
        KEY_UP => Some(Transition::Release(key)),
        FLAGS_CHANGED => {
            let side = modifier(code).and_then(|(flag, sides)| {
                let &(_, device) = sides.iter().find(|&&(side, _)| side == code)?;
                Some((flag, device))
            });
            let down = match side {
                Some((_, device)) if flags & DEVICE_FLAGS != 0 => flags & device != 0,
                Some((flag, _)) => flags & flag != 0,
                None => !held(key),
            };
            Some(if down { Transition::Press(key) } else { Transition::Release(key) })
        }
        _ => None,
    }
}
