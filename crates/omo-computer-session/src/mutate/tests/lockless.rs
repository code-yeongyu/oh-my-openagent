//! A-IS-65 L10(b), test T9: a session with no RUNTIME root has no interaction lock, so over a
//! real backend every exec refuses with nothing sent. Only the fake acts without the lock.

use omo_computer_backend_fake::FakeBackend;
use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::results::DisplayInfo;

use super::{click, open, wire, Run};
use crate::Session;

/// The fake under another backend's name: a real backend as the session sees it.
struct Real(FakeBackend);

impl Backend for Real {
    fn capabilities(&self) -> Capabilities {
        let mut capabilities = self.0.capabilities();
        "win32".clone_into(&mut capabilities.backend);
        capabilities
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.0.windows(filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.0.displays()
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        self.0.capture(target, options)
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

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        self.0.epoch_source()
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        self.0.presence()
    }
}

#[test]
fn a_real_backend_session_with_no_runtime_root_refuses_exec_with_nothing_sent() {
    let run = Run::new();
    let mut session = open(Session::new(Box::new(Real(run.fake()))));
    let refused = session
        .click(click("c-lockless"))
        .expect_err("no interaction lock, no exec");
    assert_eq!(wire(&refused), ("TransactionFailed", None));
    assert!(run.sink.is_empty(), "nothing sent");
}

#[test]
fn the_fake_still_acts_in_a_session_with_no_runtime_root() {
    let run = Run::new();
    let mut session = open(Session::new(Box::new(run.fake())));
    session.click(click("c-fake")).expect("delivered");
    assert!(!run.sink.is_empty(), "the fake's sink recorded the click");
}
