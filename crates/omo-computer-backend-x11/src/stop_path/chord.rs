//! The stop chord as XI2 raw key events see it. Raw events carry keycodes and no modifier
//! state, so the listener tracks which keycodes are down and fires when the trigger goes down
//! while every chord modifier is held.

use std::collections::BTreeSet;

use super::server::KeyMap;

/// The X11 spelling of the default stop chord (`computer.stopHotkey` on Linux).
pub const DEFAULT_STOP_CHORD: &str = "ctrl+alt+shift+escape";

/// `XK_Escape`: a bare physical Escape ends the foreground lease.
pub const ESCAPE_KEYSYM: u32 = 0xff1b;

const MODIFIERS: &[(&str, &[u32])] = &[
    ("ctrl", &[0xffe3, 0xffe4]),
    ("control", &[0xffe3, 0xffe4]),
    ("alt", &[0xffe9, 0xffea, 0xffe7, 0xffe8]),
    ("shift", &[0xffe1, 0xffe2]),
    ("super", &[0xffeb, 0xffec]),
    ("win", &[0xffeb, 0xffec]),
];

const NAMED_KEYS: &[(&str, u32)] = &[
    ("escape", ESCAPE_KEYSYM),
    ("esc", ESCAPE_KEYSYM),
    ("return", 0xff0d),
    ("enter", 0xff0d),
    ("tab", 0xff09),
    ("space", 0x20),
    ("backspace", 0xff08),
    ("delete", 0xffff),
    ("pause", 0xff13),
];

/// Why a chord cannot be listened for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChordError {
    /// Not modifiers plus exactly one known key.
    Invalid,
    /// The keymap has no keycode for one of its keys, so it could never be typed.
    Unmapped,
}

fn trigger_keysym(name: &str) -> Option<u32> {
    if let Some((_, keysym)) = NAMED_KEYS.iter().find(|(known, _)| *known == name) {
        return Some(*keysym);
    }
    if let Some(number) = name.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
        return (1..=24).contains(&number).then(|| 0xffbd + number);
    }
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_lowercase() || c.is_ascii_digit() => Some(u32::from(c)),
        _ => None,
    }
}

/// The chord as keysyms: one trigger key and the modifier groups that must be held.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hotkey {
    trigger: u32,
    modifiers: Vec<&'static [u32]>,
}

impl Hotkey {
    /// # Errors
    /// [`ChordError::Invalid`] unless the chord is modifiers plus exactly one known key.
    pub fn parse(chord: &str) -> Result<Self, ChordError> {
        let mut trigger = None;
        let mut modifiers = Vec::new();
        for part in chord.split('+') {
            let part = part.trim().to_ascii_lowercase();
            if let Some((_, group)) = MODIFIERS.iter().find(|(name, _)| *name == part) {
                modifiers.push(*group);
            } else if trigger
                .replace(trigger_keysym(&part).ok_or(ChordError::Invalid)?)
                .is_some()
            {
                return Err(ChordError::Invalid);
            }
        }
        Ok(Self {
            trigger: trigger.ok_or(ChordError::Invalid)?,
            modifiers,
        })
    }

    /// The keycodes of this chord on `keymap`.
    ///
    /// # Errors
    /// [`ChordError::Unmapped`] when a chord key has no keycode.
    pub fn resolve(&self, keymap: &KeyMap) -> Result<ChordCodes, ChordError> {
        let codes = |keysyms: &[u32]| -> Result<BTreeSet<u8>, ChordError> {
            let codes: BTreeSet<u8> = keysyms
                .iter()
                .flat_map(|&keysym| keymap.codes(keysym))
                .collect();
            if codes.is_empty() {
                Err(ChordError::Unmapped)
            } else {
                Ok(codes)
            }
        };
        Ok(ChordCodes {
            trigger: codes(&[self.trigger])?,
            modifiers: self
                .modifiers
                .iter()
                .map(|group| codes(group))
                .collect::<Result<_, _>>()?,
            escape: keymap.codes(ESCAPE_KEYSYM).into_iter().collect(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChordCodes {
    trigger: BTreeSet<u8>,
    modifiers: Vec<BTreeSet<u8>>,
    escape: BTreeSet<u8>,
}

/// What one physical press means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Press {
    Stop,
    /// A bare Escape with no other key held.
    LeaseEnd,
    Other,
}

/// Keycodes currently down on physical keyboards.
#[derive(Debug, Default)]
pub struct Pressed {
    down: BTreeSet<u8>,
}

impl Pressed {
    /// Records a press. Extra held keys still complete the chord: a stop is never missed for a
    /// stray key.
    pub fn press(&mut self, code: u8, chord: &ChordCodes) -> Press {
        let alone = self.down.iter().all(|held| *held == code);
        self.down.insert(code);
        let held = |group: &BTreeSet<u8>| group.iter().any(|code| self.down.contains(code));
        if chord.trigger.contains(&code) && chord.modifiers.iter().all(held) {
            Press::Stop
        } else if alone && chord.escape.contains(&code) {
            Press::LeaseEnd
        } else {
            Press::Other
        }
    }

    pub fn release(&mut self, code: u8) {
        self.down.remove(&code);
    }
}
