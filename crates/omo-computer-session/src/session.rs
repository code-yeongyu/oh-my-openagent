//! One engine session over one backend: `session.open`, `capabilities`, `session.close` and
//! the thinnest `click` and `typeText` - the backend call and the reply shape. The gate, the
//! mutate funnel, consent, receipts and settle are put around the two verbs by later rows.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

use omo_computer_core::backend::{
    Backend, InputEvent, PermissionProbe, Refusal, Route, TaggedInput,
};
use omo_computer_core::error::EngineCode;
use omo_computer_core::capabilities::{Capabilities, InputMode, LegacyCapabilities};
use omo_computer_core::params::{
    Button, ClickParams, Delivery, Point, ReportMode, SessionOpenParams, TypeTextParams,
};
use omo_computer_core::requests::{read_click, read_session_open, read_type_text, V1Request, Verb};
use omo_computer_core::results::{
    CapabilitiesReply, ExecReply, PermissionState, SessionOpened,
};
use omo_computer_core::session_state::Tristate;

/// `stopReason` while no stop path is armed: `session.open` arms none (`stopPath.start` does).
pub const NO_GLOBAL_LISTENER: &str = "no-global-listener";

/// An exec call with no open session: the session's bare `Closed` row.
pub const NOT_OPEN: Refusal = Refusal::bare(EngineCode::Closed);

/// A click that names no point (a ref-aimed click needs the accessibility rows): the bare
/// `InvalidTarget` row.
pub const POINT_REQUIRED: Refusal = Refusal::bare(EngineCode::InvalidTarget);

struct Opened {
    report_mode: ReportMode,
    tag: u64,
}

/// The session state of one engine process.
pub struct Session {
    backend: Box<dyn Backend>,
    opened: Option<Opened>,
}

impl Session {
    #[must_use]
    pub fn new(backend: Box<dyn Backend>) -> Self {
        Self {
            backend,
            opened: None,
        }
    }

    /// Opens (or re-opens) the session and answers its capabilities and a fresh resume token.
    pub fn open(&mut self, params: SessionOpenParams) -> SessionOpened {
        let request = read_session_open(params);
        self.opened = Some(Opened {
            report_mode: request.report_mode,
            tag: random_u64(),
        });
        SessionOpened {
            capabilities: self.capabilities(),
            resume_token: format!("{:016x}{:016x}", random_u64(), random_u64()),
        }
    }

    /// The capabilities in the open session's report mode; with no session, the v1 shape.
    #[must_use]
    pub fn capabilities(&self) -> CapabilitiesReply {
        let capabilities = self.backend.capabilities();
        match self.opened.as_ref().map(|opened| opened.report_mode) {
            Some(ReportMode::Object) => CapabilitiesReply::Object(Box::new(capabilities)),
            Some(ReportMode::Null) | None => CapabilitiesReply::Legacy(Box::new(legacy_capabilities(
                &capabilities,
                &self.backend.probe_permissions(),
            ))),
        }
    }

    pub fn close(&mut self) {
        self.opened = None;
    }

    /// # Errors
    /// [`NOT_OPEN`], [`POINT_REQUIRED`], or the backend's refusal; nothing is sent on any.
    pub fn click(&mut self, params: ClickParams) -> Result<ExecReply, Refusal> {
        let request = read_click(params);
        let Verb::Click {
            at,
            button,
            count,
            modifiers,
            consume: _,
        } = request.verb
        else {
            unreachable!("read_click always reads a click");
        };
        let at = at.ok_or(POINT_REQUIRED)?;
        let route = route_for(request.target.as_deref(), request.policy.delivery);
        let button = button.unwrap_or(Button::Left);
        let mut events = vec![InputEvent::PointerMove(Point { x: at.x, y: at.y })];
        events.extend(modifiers.iter().map(|key| key_event(key, true)));
        for _ in 0..count.unwrap_or(1) {
            events.push(InputEvent::Button { button, down: true });
            events.push(InputEvent::Button { button, down: false });
        }
        events.extend(modifiers.iter().rev().map(|key| key_event(key, false)));
        self.send(events, route)
    }

    /// # Errors
    /// [`NOT_OPEN`] or the backend's refusal.
    pub fn type_text(&mut self, params: TypeTextParams) -> Result<ExecReply, Refusal> {
        let V1Request::TypeText { target, text } = read_type_text(params) else {
            unreachable!("read_type_text always reads a typeText");
        };
        let route = route_for(Some(target.as_str()), None);
        self.send(vec![InputEvent::Text(text)], route)
    }

    /// Null in both report modes for now: the object-mode `ActionReport` is built by the
    /// rows that own receipts and dispositions.
    fn send(&mut self, events: Vec<InputEvent>, route: Route) -> Result<ExecReply, Refusal> {
        let tag = self.opened.as_ref().ok_or(NOT_OPEN)?.tag;
        for event in events {
            self.backend.post_input(&TaggedInput { event, tag }, route)?;
        }
        Ok(ExecReply(None))
    }
}

fn key_event(key: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: key.to_owned(),
        down,
    }
}

/// A call aimed at a window goes to that window in the background unless it asks for the
/// foreground; a call with no target can only reach the foreground.
fn route_for(target: Option<&str>, delivery: Option<Delivery>) -> Route {
    match (target, delivery) {
        (Some(_), None | Some(Delivery::Background)) => Route::BackgroundWindow,
        (None, _) | (Some(_), Some(Delivery::Foreground)) => Route::ForegroundHid,
    }
}

fn random_u64() -> u64 {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    hasher.finish()
}

const fn permission(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Unknown => "unknown",
    }
}

const fn known_true(state: Tristate) -> bool {
    matches!(state, Tristate::Known(true))
}

/// The v1 record a null-mode session reads, projected from the object-mode capabilities.
#[must_use]
pub fn legacy_capabilities(caps: &Capabilities, probe: &PermissionProbe) -> LegacyCapabilities {
    LegacyCapabilities {
        backend: caps.backend.clone(),
        display_server: None,
        capture: caps.capture.available,
        input: caps.window_input.available,
        ax: caps.input_modes.contains(&InputMode::Ax),
        background_window_input: caps.background_window_input,
        cursor_overlay: false,
        delivery_modes: caps.delivery_modes.clone(),
        capture_permission: permission(probe.capture).to_owned(),
        input_permission: permission(probe.input).to_owned(),
        ax_permission: permission(probe.accessibility).to_owned(),
        display_count: caps.display_count,
        focus_guard: caps.background_window_input,
        stop_path: "none".to_owned(),
        stop_reason: Some(NO_GLOBAL_LISTENER.to_owned()),
        integrity_level: None,
        screen_locked: known_true(caps.session.screen_locked),
        display_asleep: Some(known_true(caps.session.display_asleep)),
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{FakeBackend, FakeScenario, RecordingSink};
    use serde_json::json;

    use super::*;

    fn session(sink: &RecordingSink) -> Session {
        let backend = FakeBackend::with_parts(
            FakeScenario::default(),
            omo_computer_backend_fake::FakeClock::default(),
            sink.clone(),
        );
        Session::new(Box::new(backend))
    }

    fn params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
        serde_json::from_value(value).expect("params parse")
    }

    #[test]
    fn exec_before_open_sends_nothing() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        let result = session.type_text(params(json!({"target": "1", "text": "hi"})));
        assert_eq!(result, Err(NOT_OPEN));
        assert!(sink.is_empty());
        assert!(NOT_OPEN.computer_code().is_ok() && POINT_REQUIRED.computer_code().is_ok());
    }

    #[test]
    fn null_mode_click_posts_and_replies_null() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        session.open(params(json!({})));
        let reply = session.click(params(json!({"target": "1", "x": 3, "y": 4})));
        assert_eq!(reply, Ok(ExecReply(None)));
        assert_eq!(sink.len(), 3, "move, down, up: {:?}", sink.lines());
        assert!(sink.lines().iter().all(|line| line.contains("route=backgroundwindow")));
    }

    #[test]
    fn object_mode_reads_object_capabilities_and_close_ends_the_session() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        let opened = session.open(params(json!({"reportMode": "object"})));
        assert!(matches!(opened.capabilities, CapabilitiesReply::Object(_)));
        assert_eq!(opened.resume_token.len(), 32);
        session.close();
        assert!(matches!(session.capabilities(), CapabilitiesReply::Legacy(_)));
        let after = session.type_text(params(json!({"target": "1", "text": "x"})));
        assert_eq!(after, Err(NOT_OPEN));
    }
}
