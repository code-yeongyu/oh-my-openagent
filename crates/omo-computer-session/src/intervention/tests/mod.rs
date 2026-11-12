//! Row 22 on the fake: the exact `delivered{count, of}` of an interrupted text, the takeover
//! pause before a send, and a target that exits mid-text.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Route, StopListener, TaggedInput,
    WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::intervention::{
    BackendClock, InterventionSource, Pause, PauseReason, TargetLiveness, TargetState,
    TextDelivery,
};
use omo_computer_core::report::Disposition;
use omo_computer_core::results::ExecReply;
use serde_json::json;

use crate::{Refused, Session};

pub(crate) const WINDOW: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]"#;

pub(crate) fn fake(extra: &str) -> (FakeBackend, RecordingSink) {
    let sink = RecordingSink::default();
    let scenario = FakeScenario::from_json(&format!("{{{WINDOW}{extra}}}")).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    (backend, sink)
}

pub(crate) fn params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// An object-mode session over `backend` with the stop path armed.
pub(crate) fn object_session(backend: Box<dyn Backend>) -> Session {
    let mut session = Session::new(backend);
    session
        .open(params(json!({"reportMode": "object"})))
        .expect("open");
    session.stop_path_start(params(json!({})));
    session
}

pub(crate) fn wire(refused: &Refused) -> (&'static str, Option<&'static str>) {
    (refused.refusal.code.wire(), refused.refusal.reason)
}

pub(crate) fn report(reply: ExecReply) -> omo_computer_core::report::ActionReport {
    reply.0.expect("an object-mode reply carries the ActionReport")
}

/// A click on window 101 that names a frame of it captured first (row 20's frame rule, R25);
/// when the capture itself is refused the click goes without one, so an earlier stage answers.
/// A foreground click takes row 21's human grant first.
pub(crate) trait FramedClick {
    fn framed_click(&mut self, delivery: Option<&str>) -> Result<ExecReply, Refused>;
}

impl FramedClick for Session {
    fn framed_click(&mut self, delivery: Option<&str>) -> Result<ExecReply, Refused> {
        let mut call = json!({"target": "101", "x": 10, "y": 10});
        if let Ok(frame) = self.capture_frame("101", true, None) {
            call["frameId"] = json!(frame.frame_id);
        }
        if let Some(delivery) = delivery {
            if delivery == "foreground" {
                // Row 21: foreground delivery needs the human grant first (AC-12).
                self.control_grant(params(json!({ "reason": "test" })));
            }
            call["delivery"] = json!(delivery);
        }
        self.click(params(call))
    }
}

mod display_awake;
mod liveness;
mod typing;
