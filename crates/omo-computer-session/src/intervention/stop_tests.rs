//! R53: a stop is never held. The send loop polls the stop listener between units, so a stop
//! chord pressed mid-stroke ends it there with the latch's own reason and the exact
//! `delivered{count, of}`; with no stop, every send keeps its counts and events.

use omo_computer_backend_fake::FakeBackend;
use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Route, StopListener, TaggedInput, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::intervention::{BackendClock, InterventionSource};
use serde_json::json;

use super::tests::{fake, object_session, params, FramedClick};

/// The fake, with the user pressing the stop chord right after the `after`-th input post.
struct StopAfter {
    inner: FakeBackend,
    after: usize,
    posts: usize,
}

impl Backend for StopAfter {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }
    fn capture(
        &mut self,
        target: &omo_computer_core::backend::Target,
        options: &omo_computer_core::backend::CaptureOptions,
    ) -> BackendResult<omo_computer_core::backend::FrameBytes> {
        self.inner.capture(target, options)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        let sent = self.inner.post_input(input, route);
        self.posts += 1;
        if self.posts == self.after {
            self.inner.press_stop_chord();
        }
        sent
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.inner.stop_listener()
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }
    fn clock(&self) -> Option<&dyn BackendClock> {
        Backend::clock(&self.inner)
    }
    fn intervention(&self) -> Option<&dyn InterventionSource> {
        self.inner.intervention()
    }
}

#[test]
fn a_stop_between_units_ends_the_stroke_with_the_exact_count() {
    let (inner, sink) = fake("");
    let mut session = object_session(Box::new(StopAfter { inner, after: 1, posts: 0 }));
    let refused = session.framed_click(None).expect_err("the stop chord ends the click");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("Suspended", Some("hotkey")));
    assert_eq!(
        refused.stamps.delivered,
        Some(omo_computer_core::backend::Delivered { count: 1, of: 3 }),
        "the move went out; the button never went down"
    );
    let posts: Vec<String> = sink.lines().into_iter().filter(|l| l.starts_with("post_input")).collect();
    assert_eq!(posts.len(), 1, "nothing after the stop: {posts:?}");
}

#[test]
fn with_no_stop_every_send_keeps_its_counts_and_events() {
    let (inner, sink) = fake("");
    let mut session = object_session(Box::new(inner));
    let reply = session.framed_click(None).expect("click");
    let report = serde_json::to_value(reply).expect("report");
    assert_eq!(report["delivered"], json!({"count": 3, "of": 3}));
    let events: Vec<String> = sink
        .lines()
        .into_iter()
        .filter(|l| l.starts_with("post_input"))
        .filter_map(|l| l.splitn(4, ' ').nth(3).map(str::to_owned))
        .collect();
    assert_eq!(events, ["pointer_move x=10 y=10", "button left down=true", "button left down=false"]);
    let typed = session.type_text(params(json!({"target": "101", "text": "abc"}))).expect("typeText");
    let typed = serde_json::to_value(typed).expect("report");
    assert_eq!(typed["delivered"], json!({"count": 3, "of": 3}), "one unit per scalar, unchanged");
}
