//! Rows 51/57: a backend whose release helper is unavailable cannot lift what the engine's death
//! leaves down, so `key.down` and `mouse.down` are refused before anything is sent; every
//! verb that holds nothing past its own call is kept.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::{Backend, BackendResult, Delivered, PermissionProbe, Route, StopListener, TaggedInput, WindowFilter, WindowList};
use omo_computer_core::capabilities::{Capabilities, ReleaseHelper, ReleaseHelperReason};
use omo_computer_core::methods::Method;
use serde_json::json;

use super::{reason, Fixture, WINDOWS};
use crate::Session;

/// The fake, reporting its release helper unavailable (Wayland's unproven release).
struct ReleaseUnproven(FakeBackend);

impl Backend for ReleaseUnproven {
    fn capabilities(&self) -> Capabilities {
        let mut capabilities = self.0.capabilities();
        capabilities.release_helper = Some(ReleaseHelper { available: false, reason: Some(ReleaseHelperReason::WaylandReleaseUnproven) });
        capabilities
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.0.windows(filter)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.0.post_input(input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.0.stop_listener()
    }

    fn probe_permissions(&self) -> PermissionProbe {
        self.0.probe_permissions()
    }

    fn clock(&self) -> Option<&dyn omo_computer_core::intervention::BackendClock> {
        Backend::clock(&self.0)
    }
}

#[test]
fn holds_are_refused_while_the_release_helper_is_unavailable() {
    let sink = RecordingSink::default();
    let clock = FakeClock::default();
    let scenario = FakeScenario::from_json(&format!("{{{WINDOWS}}}")).expect("scenario");
    let fake = FakeBackend::with_parts(scenario, clock.clone(), sink.clone()).with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(ReleaseUnproven(fake)));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open params")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start params"));
    let mut fixture = Fixture { session, sink, clock };
    fixture.grant();

    let refused = fixture.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect_err("key.down refused");
    assert_eq!(reason(&refused), ("StopPathUnavailable", Some("release_helper_unavailable")));
    let refused = fixture.call(Method::MouseDown, json!({"target": "101", "x": 5, "y": 5})).expect_err("mouse.down refused");
    assert_eq!(reason(&refused), ("StopPathUnavailable", Some("release_helper_unavailable")));
    assert!(fixture.inputs().is_empty(), "nothing sent: {:?}", fixture.inputs());
}
