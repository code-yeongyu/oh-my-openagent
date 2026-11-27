//! Row 26's send-on-enter guard on X11: a Return (or another chord the rule lists) into the
//! focused AT-SPI `entry`, `text` or `document text` of a client whose exact `WM_CLASS` key
//! `computer.send_on_enter` lists is refused `ConsequentialAction{send_on_enter}` before anything
//! is sent. A role the backend cannot read counts as a composer: the guard fails closed.

use std::collections::BTreeSet;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::keys::chord_keys;

use super::keys::{graphemes, keysym, name_of, RETURN};
use super::server::InputServer;
use super::X11Input;

const COMPOSER_ROLES: [&str; 3] = ["entry", "text", "document text"];
const MODIFIERS: [&str; 4] = ["shift", "ctrl", "alt", "cmd"];

impl<S: InputServer> X11Input<S> {
    /// Guards a key down of `key` (a canonical key name) with the modifiers the engine holds.
    pub(super) fn guard_enter(&mut self, key: &str) -> Result<(), Refusal> {
        if self.settings.send_on_enter.is_empty() {
            return Ok(());
        }
        let mut chord: BTreeSet<String> = self.held_modifiers();
        chord.insert(key.to_owned());
        self.guard_chord(&chord)
    }

    /// Guards typed text: a newline grapheme is a bare Return.
    pub(super) fn guard_enter_text(&mut self, text: &str) -> Result<(), Refusal> {
        if graphemes(text).any(|grapheme| keysym(grapheme) == Some(RETURN)) {
            return self.guard_chord(&BTreeSet::from(["return".to_owned()]));
        }
        Ok(())
    }

    fn guard_chord(&mut self, chord: &BTreeSet<String>) -> Result<(), Refusal> {
        if self.settings.send_on_enter.is_empty() {
            return Ok(());
        }
        let Some(window) = self.server.focus().ok() else {
            return Ok(());
        };
        let class = self
            .server
            .evidence(window)
            .map(|evidence| evidence.wm_class)
            .unwrap_or_default();
        let Some(rule) = self.settings.send_on_enter.get(&class) else {
            return Ok(());
        };
        let chords: Vec<&str> = if rule.chords.is_empty() {
            vec!["return"]
        } else {
            rule.chords.iter().map(String::as_str).collect()
        };
        let sends = chords
            .iter()
            .filter_map(|listed| chord_keys(listed).ok())
            .any(|keys| keys.into_iter().collect::<BTreeSet<_>>() == *chord);
        let composer =
            (self.focused_role)().is_none_or(|role| COMPOSER_ROLES.contains(&role.as_str()));
        if sends && composer {
            Err(Refusal::new(
                EngineCode::ConsequentialAction,
                Reason::SendOnEnter,
            ))
        } else {
            Ok(())
        }
    }

    fn held_modifiers(&self) -> BTreeSet<String> {
        let Ok(keyboard) = self.server.keyboard() else {
            return BTreeSet::new();
        };
        self.ledger
            .engine_codes()
            .into_iter()
            .filter_map(|code| {
                keyboard
                    .map
                    .keysym_at(keyboard.group, code)
                    .and_then(name_of)
            })
            .filter(|name| MODIFIERS.contains(&name.as_str()))
            .collect()
    }
}
