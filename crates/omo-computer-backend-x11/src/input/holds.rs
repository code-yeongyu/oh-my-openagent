//! The key-hold ledger. Keys the user holds are theirs: whether a key was already down is read
//! with `QueryKeymap` when the engine presses it, and a key that was down then is never released
//! by the engine, on any exit path (design row L5). A button remembers where it went down, so a
//! release first warps the pointer back to that origin. Every engine-owned hold is written to the
//! witness (the release helper's pipe) BEFORE it is pressed and after it is released, so a dead
//! engine's helper releases exactly what is still down.

use std::io::Write;

use crate::release_helper::Note;

/// A key the engine pressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldKey {
    pub code: u8,
    /// The user held it already when the engine pressed it: the engine never releases it.
    pub user_held: bool,
    /// Pressed inside one call (a typed grapheme, its Shift), not a hold the call leaves down.
    pub transient: bool,
}

/// A button the engine pressed, and the root point it went down at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldButton {
    pub detail: u8,
    pub origin: (i16, i16),
}

#[derive(Default)]
pub struct Ledger {
    keys: Vec<HeldKey>,
    buttons: Vec<HeldButton>,
    pub(crate) witness: Option<Box<dyn Write + Send>>,
}

impl Ledger {
    pub(crate) fn note(&mut self, note: &Note) {
        if let Some(witness) = self.witness.as_mut() {
            let line = format!("{note}\n");
            if let Err(error) = witness
                .write_all(line.as_bytes())
                .and_then(|()| witness.flush())
            {
                eprintln!("omo-computer-backend-x11: release helper unreachable: {error}");
                self.witness = None;
            }
        }
    }

    pub fn key_down(&mut self, key: HeldKey) {
        if !key.user_held {
            self.note(&Note::Key(key.code));
        }
        self.keys.retain(|held| held.code != key.code);
        self.keys.push(key);
    }

    /// Takes `code` out of the ledger (call it after the release went out).
    pub fn key_up(&mut self, code: u8) {
        if let Some(at) = self.keys.iter().rposition(|held| held.code == code) {
            if !self.keys.remove(at).user_held {
                self.note(&Note::Unkey(code));
            }
        }
    }

    pub fn button_down(&mut self, button: HeldButton) {
        self.note(&Note::Button(button.detail, button.origin));
        self.buttons.retain(|held| held.detail != button.detail);
        self.buttons.push(button);
    }

    #[must_use]
    pub fn button(&self, detail: u8) -> Option<HeldButton> {
        self.buttons
            .iter()
            .find(|held| held.detail == detail)
            .copied()
    }

    pub fn button_up(&mut self, detail: u8) {
        let before = self.buttons.len();
        self.buttons.retain(|held| held.detail != detail);
        if self.buttons.len() != before {
            self.note(&Note::Unbutton(detail));
        }
    }

    /// Whether the engine holds `code` (a user-held key is the user's, not the engine's).
    #[must_use]
    pub fn engine_holds(&self, code: u8) -> bool {
        self.keys
            .iter()
            .any(|held| held.code == code && !held.user_held)
    }

    /// The keycodes the engine holds, press order.
    #[must_use]
    pub fn engine_codes(&self) -> Vec<u8> {
        self.keys
            .iter()
            .filter(|held| !held.user_held)
            .map(|held| held.code)
            .collect()
    }

    /// The engine-owned keys to release, last press first (`transient_only`: only the strokes
    /// of the current call). They stay in the ledger until [`Self::key_up`].
    #[must_use]
    pub fn releases(&self, transient_only: bool) -> Vec<u8> {
        let wanted = |held: &&HeldKey| !held.user_held && (held.transient || !transient_only);
        self.keys
            .iter()
            .rev()
            .filter(wanted)
            .map(|held| held.code)
            .collect()
    }

    /// Forgets the user-held entries of the scope, which the engine never releases.
    pub fn forget_user_held(&mut self, transient_only: bool) {
        self.keys
            .retain(|held| !(held.user_held && (held.transient || !transient_only)));
    }

    /// Every held button, last press first.
    #[must_use]
    pub fn buttons(&self) -> Vec<HeldButton> {
        self.buttons.iter().rev().copied().collect()
    }
}
