//! The send-on-Enter composer guard (row 26; acceptance 80; principle 11(v); d-safety.md
//! 'Consequential'). Return in a chat or mail composer SENDS to another person, so a send chord
//! into the focused composer of an app whose EXACT key is in `computer.send_on_enter` is refused
//! `ConsequentialAction{reason:"send_on_enter", app, composer:{role,label}, nextCall}` unless the
//! call carries `force:true`. A bare chord is refused with nothing sent; a newline in typed text
//! is a Return press, so the text before it is delivered and the rest refused. `shift+return` is
//! not a send chord unless an entry lists it.

use serde_json::{json, Value};

use crate::backend::{InputEvent, Refusal};
use crate::error::{EngineCode, Reason};
use crate::settings::SendOnEnterRule;

/// The native roles of a composer: macOS `AXTextArea`, AT-SPI `text`, UIA `Edit`.
pub const COMPOSER_ROLES: [&str; 3] = ["AXTextArea", "text", "Edit"];

/// An entry that names no chord sends on a bare Return.
const DEFAULT_CHORD: &str = "return";

/// The call the refusal suggests: a line break, which never sends.
pub const NEXT_CALL: &str = "press(\"shift+return\")";

const MODIFIERS: [&str; 8] = ["shift", "ctrl", "control", "alt", "opt", "option", "cmd", "meta"];

/// Where a call's events would send into a listed composer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cut {
    /// Nothing in the call sends.
    Nothing,
    /// A send chord: the whole call is refused before anything is sent.
    Chord,
    /// A newline in the `event`-th event (a text): the `prefix` before it goes out, nothing after.
    Text { event: usize, prefix: String },
}

/// The focused composer a refusal names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composer {
    pub app: String,
    pub role: String,
    pub label: Option<String>,
}

impl Composer {
    /// `ConsequentialAction{reason:"send_on_enter"}`; its members go in [`Self::detail`].
    #[must_use]
    pub const fn refusal() -> Refusal {
        Refusal::new(EngineCode::ConsequentialAction, Reason::SendOnEnter.wire())
    }

    /// `app`, `composer:{role,label}` and `nextCall`, beside the code on the wire.
    #[must_use]
    pub fn detail(&self) -> Value {
        json!({
            "app": self.app,
            "composer": { "role": self.role, "label": self.label },
            "nextCall": NEXT_CALL,
        })
    }
}

fn canonical(chord: &str) -> Vec<String> {
    let mut keys: Vec<String> = chord
        .split('+')
        .map(|key| match key.trim().to_ascii_lowercase().as_str() {
            "enter" => "return".to_owned(),
            "control" => "ctrl".to_owned(),
            "option" | "opt" => "alt".to_owned(),
            "meta" => "cmd".to_owned(),
            other => other.to_owned(),
        })
        .collect();
    keys.sort();
    keys
}

/// Where `events` would send under `rule` (the entry of the focused composer's app).
#[must_use]
pub fn cut(events: &[InputEvent], rule: &SendOnEnterRule) -> Cut {
    let chords: Vec<Vec<String>> = if rule.chords.is_empty() {
        vec![canonical(DEFAULT_CHORD)]
    } else {
        rule.chords.iter().map(|chord| canonical(chord)).collect()
    };
    let mut held: Vec<String> = Vec::new();
    for (index, event) in events.iter().enumerate() {
        match event {
            InputEvent::Key { key, down: true } => {
                let key = key.to_ascii_lowercase();
                if MODIFIERS.contains(&key.as_str()) {
                    held.push(key);
                    continue;
                }
                let pressed = canonical(&[held.join("+"), key].join("+").trim_start_matches('+').to_owned());
                if chords.contains(&pressed) {
                    return Cut::Chord;
                }
            }
            InputEvent::Key { key, down: false } => {
                let key = key.to_ascii_lowercase();
                held.retain(|h| *h != key);
            }
            InputEvent::Text(text) if held.is_empty() && chords.contains(&canonical(DEFAULT_CHORD)) => {
                if let Some(at) = text.find('\n') {
                    return Cut::Text { event: index, prefix: text[..at].to_owned() };
                }
            }
            _ => {}
        }
    }
    Cut::Nothing
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str, down: bool) -> InputEvent {
        InputEvent::Key { key: name.to_owned(), down }
    }

    fn rule(chords: &[&str]) -> SendOnEnterRule {
        SendOnEnterRule { chords: chords.iter().map(|c| (*c).to_owned()).collect() }
    }

    #[test]
    fn a_bare_return_is_a_send_chord_and_shift_return_is_not() {
        assert_eq!(cut(&[key("return", true), key("return", false)], &rule(&[])), Cut::Chord);
        assert_eq!(cut(&[key("enter", true)], &rule(&[])), Cut::Chord, "enter is return");
        let shifted = [key("shift", true), key("return", true), key("return", false), key("shift", false)];
        assert_eq!(cut(&shifted, &rule(&[])), Cut::Nothing);
        assert_eq!(cut(&shifted, &rule(&["shift+return"])), Cut::Chord, "an entry's own chord");
        assert_eq!(cut(&[key("a", true), key("a", false)], &rule(&[])), Cut::Nothing);
    }

    #[test]
    fn a_newline_in_text_cuts_it_before_the_newline() {
        let events = [InputEvent::Text("done\nmore".to_owned())];
        assert_eq!(cut(&events, &rule(&[])), Cut::Text { event: 0, prefix: "done".to_owned() });
        assert_eq!(cut(&[InputEvent::Text("done".to_owned())], &rule(&[])), Cut::Nothing);
        assert_eq!(cut(&events, &rule(&["cmd+return"])), Cut::Nothing, "the entry sends only on cmd+return");
    }

    #[test]
    fn the_refusal_names_the_app_the_composer_and_the_line_break_call() {
        let composer = Composer { app: "com.example.chat".to_owned(), role: "AXTextArea".to_owned(), label: Some("Message".to_owned()) };
        assert_eq!(Composer::refusal().reason, Some("send_on_enter"));
        assert_eq!(
            composer.detail(),
            json!({ "app": "com.example.chat", "composer": { "role": "AXTextArea", "label": "Message" }, "nextCall": NEXT_CALL })
        );
    }
}
