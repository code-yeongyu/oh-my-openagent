//! Row 26's text guards at the session, before the marker: a remote-screen window's text is
//! admitted against its fixed layout (acceptance 81's remote leg), and the call's events are cut
//! against the entry of the focused composer's app in the session's `computer.send_on_enter`
//! table (acceptance 80; `force:true` is the only override).

use omo_computer_core::ax::{AxHandle, AxReader, NodeRead, Slice};
use omo_computer_core::backend::{InputEvent, WindowFilter};
use omo_computer_core::keys::unresolvable::admit_remote_text;
use omo_computer_core::send_on_enter::{cut, Composer, Cut, COMPOSER_ROLES};
use omo_computer_safety::TargetRef;
use serde_json::Value;

use crate::intervention::{units, Outcome, Stop};
use crate::mutate::{Mutation, Refused};
use crate::Session;

/// The most nodes the focused-composer read visits.
const NODE_BUDGET: usize = 512;
const SLICE_MS: u64 = 50;

/// A text cut at its first newline: the units the whole call had, and the refusal's members.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TextCut {
    of: u32,
    detail: Value,
}

impl TextCut {
    /// The send of the text before the newline ends with the refusal; `delivered{count, of}`
    /// counts the whole call.
    pub(crate) fn finish(cut: Option<Self>, outcome: Outcome) -> Outcome {
        match cut {
            Some(cut) if outcome.stop.is_none() => Outcome {
                count: outcome.count,
                of: cut.of,
                stop: Some(Stop::Consequential {
                    refusal: Composer::refusal(),
                    detail: Box::new(cut.detail),
                }),
            },
            _ => outcome,
        }
    }
}

fn is_composer(node: &NodeRead) -> bool {
    node.focused == Some(true)
        && (node.native_role.as_deref().is_some_and(|role| COMPOSER_ROLES.contains(&role)) || node.role == "textarea")
}

fn focused_composer(reader: &mut dyn AxReader, window: &str) -> Option<NodeRead> {
    let root = reader.root(window).ok()?;
    let mut stack: Vec<AxHandle> = root.node.handle.into_iter().collect();
    let mut seen = 0;
    while let Some(handle) = stack.pop() {
        let Slice::Read(children) = reader.children(handle, 0, SLICE_MS) else {
            continue;
        };
        for child in children {
            seen += 1;
            if is_composer(&child) {
                return Some(child);
            }
            stack.extend(child.handle);
        }
        if seen >= NODE_BUDGET {
            break;
        }
    }
    None
}

impl Session {
    fn composer_of(&mut self, window: &str) -> Option<Composer> {
        let app = self
            .backend
            .windows(&WindowFilter::default())
            .ok()?
            .windows
            .into_iter()
            .find(|info| info.id == window)?
            .app_key;
        let node = focused_composer(self.backend.ax_reader()?, window)?;
        Some(Composer {
            app,
            role: node.native_role.clone().unwrap_or_else(|| node.role.clone()),
            label: node.stable_text().map(str::to_owned),
        })
    }

    /// The text guards on `mutation`: a remote screen's layout (acceptance 81), then the
    /// send-on-Enter cut (acceptance 80): a send chord refuses the call with nothing sent; a
    /// newline in typed text keeps the events before it and answers the cut to finish the call.
    ///
    /// # Errors
    /// `InvalidKey` / `BackgroundUnavailable` for a remote screen's text, or
    /// `ConsequentialAction{send_on_enter, app, composer, nextCall}` for a send chord.
    pub(crate) fn send_on_enter(&mut self, mutation: &mut Mutation<'_>) -> Result<Option<TextCut>, Refused> {
        let TargetRef::Window(window) = mutation.call.target else {
            return Ok(None);
        };
        if let Some(forwarding) = self.backend.remote_screen(window) {
            let background = mutation.route == omo_computer_core::backend::Route::BackgroundWindow;
            for event in &mutation.events {
                if let InputEvent::Text(text) = event {
                    admit_remote_text(text, forwarding, background).map_err(Refused::from)?;
                }
            }
        }
        if mutation.call.force || mutation.write.is_some() || self.funnel.send_on_enter.is_empty() {
            return Ok(None);
        }
        let Some(composer) = self.composer_of(window) else {
            return Ok(None);
        };
        let Some(rule) = self.funnel.send_on_enter.get(&composer.app) else {
            return Ok(None);
        };
        match cut(&mutation.events, rule) {
            Cut::Nothing => Ok(None),
            Cut::Chord => Err(Refused {
                detail: Some(Box::new(composer.detail())),
                ..Composer::refusal().into()
            }),
            Cut::Text { event, prefix } => {
                let of = units(&mutation.events);
                mutation.events.truncate(event);
                if !prefix.is_empty() {
                    mutation.events.push(InputEvent::Text(prefix));
                }
                Ok(Some(TextCut { of, detail: composer.detail() }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
    use serde_json::{json, Value};

    use crate::Session;

    const SCENARIO: &str = include_str!("../../omo-computer-backend-fake/fixtures/v3-apps.json");

    fn session(table: Value) -> (Session, RecordingSink) {
        let sink = RecordingSink::default();
        let fake = FakeBackend::with_parts(FakeScenario::from_json(SCENARIO).expect("scenario"), FakeClock::default(), sink.clone())
            .with_stop_path(StopPathScript::Live);
        let mut session = Session::new(Box::new(fake));
        session
            .open(serde_json::from_value(json!({ "reportMode": "object", "settings": { "send_on_enter": table } })).expect("open"))
            .expect("open");
        session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
        (session, sink)
    }

    fn listed() -> Value {
        json!({ "Notes": { "chords": [] } })
    }

    fn posts(sink: &RecordingSink) -> Vec<String> {
        sink.lines().into_iter().filter(|line| line.starts_with("post_input")).collect()
    }

    fn press(session: &mut Session, chord: &str, force: bool) -> Result<omo_computer_core::results::ExecReply, crate::Refused> {
        session.press(serde_json::from_value(json!({ "target": "101", "chord": chord, "force": force })).expect("press"))
    }

    /// Acceptance 80 (a): a bare Return into the focused composer of a listed app answers
    /// ConsequentialAction{send_on_enter, app, composer, nextCall} with nothing sent.
    #[test]
    fn send_on_enter_newline_in_listed_composer_is_refused() {
        let (mut session, sink) = session(listed());
        let refused = press(&mut session, "return", false).expect_err("a bare Return sends");
        assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("ConsequentialAction", Some("send_on_enter")));
        let detail = refused.detail.expect("the refusal's members");
        assert_eq!(detail["app"], json!("Notes"));
        assert_eq!(detail["composer"]["role"], json!("AXTextArea"));
        assert_eq!(detail["nextCall"], json!("press(\"shift+return\")"));
        assert!(posts(&sink).is_empty(), "nothing sent: {:?}", posts(&sink));
    }

    /// Acceptance 80 (b), (c): shift+return is a line break and goes out; force:true sends.
    #[test]
    fn shift_return_and_a_forced_return_are_delivered() {
        let (mut session, sink) = session(listed());
        press(&mut session, "shift+return", false).expect("a line break never sends");
        assert!(!posts(&sink).is_empty());
        let before = posts(&sink).len();
        press(&mut session, "return", true).expect("force is the override");
        assert!(posts(&sink).len() > before, "{:?}", posts(&sink));
    }

    /// Acceptance 80 (d): a newline in typed text delivers the graphemes before it and refuses
    /// the Return with delivered{count:4, of:5}.
    #[test]
    fn typed_text_is_cut_at_its_first_newline() {
        let (mut session, sink) = session(listed());
        let refused = session
            .type_text(serde_json::from_value(json!({ "target": "101", "text": "done\n" })).expect("typeText"))
            .expect_err("the newline is a Return");
        assert_eq!(refused.refusal.reason, Some("send_on_enter"));
        assert_eq!(refused.stamps.delivered, Some(omo_computer_core::backend::Delivered { count: 4, of: 5 }));
        let sent = posts(&sink);
        assert!(sent.iter().any(|line| line.ends_with(r#"text "done""#)) && !sent.iter().any(|line| line.contains("\\n")), "{sent:?}");
    }

    /// Acceptance 80 (f): the same Return into an unlisted app's composer is delivered unguarded.
    #[test]
    fn a_return_into_an_unlisted_apps_composer_is_delivered() {
        let (mut session, sink) = session(json!({ "com.example.other": { "chords": [] } }));
        press(&mut session, "return", false).expect("unlisted");
        assert!(!posts(&sink).is_empty());
    }

    /// Acceptance 81's remote leg (remote-typing.json): a character no key of the remote screen's
    /// layout types refuses InvalidKey before anything is typed; Shift text in a Screen Sharing
    /// window's background refuses BackgroundUnavailable.
    #[test]
    fn a_remote_screen_window_refuses_untypable_and_background_shift_text_before_any_key() {
        let sink = RecordingSink::default();
        let scenario = include_str!("../../omo-computer-backend-fake/fixtures/remote-typing.json");
        let fake = FakeBackend::with_parts(FakeScenario::from_json(scenario).expect("scenario"), FakeClock::default(), sink.clone())
            .with_stop_path(StopPathScript::Live);
        let mut session = Session::new(Box::new(fake));
        session.open(serde_json::from_value(json!({ "allowHostRelayOnlyStop": true })).expect("open")).expect("open");
        session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
        let typed = |session: &mut Session, target: &str, text: &str| {
            session.type_text(serde_json::from_value(json!({ "target": target, "text": text })).expect("typeText"))
        };
        let refused = typed(&mut session, "101", "ab\u{1f600}c").expect_err("no key types the emoji");
        assert_eq!(refused.refusal.code.wire(), "InvalidKey");
        let refused = typed(&mut session, "101", "Hello").expect_err("Shift in a Screen Sharing background");
        assert_eq!(refused.refusal.code.wire(), "BackgroundUnavailable");
        assert!(posts(&sink).is_empty(), "nothing typed: {:?}", posts(&sink));
        typed(&mut session, "101", "hello").expect("unshifted text goes out as keys");
        typed(&mut session, "202", "Hello World").expect("HID reports carry Shift");
    }
}
