//! Review L2 of #13355: an object-mode exec whose window listing fails is not sent with the
//! takeover gate and the mid-send watch silently off.

use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Refusal, Route, StopListener, TaggedInput, WindowFilter,
    WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::{BackendClock, InterventionSource};

use super::*;

/// The fake, its window listing failing after the frame was captured.
struct ListingFails {
    inner: FakeBackend,
    fail: bool,
}

impl Backend for ListingFails {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        if self.fail {
            return Err(Refusal::new(EngineCode::Internal, Reason::WindowsUnsupported));
        }
        self.inner.windows(filter)
    }
    fn capture(
        &mut self,
        target: &omo_computer_core::backend::Target,
        options: &omo_computer_core::backend::CaptureOptions,
    ) -> BackendResult<omo_computer_core::backend::FrameBytes> {
        let frame = self.inner.capture(target, options);
        self.fail = true;
        frame
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.inner.post_input(input, route)
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
    fn host_consent(&self) -> Option<serde_json::Value> {
        self.inner.host_consent()
    }
    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        self.inner.platform()
    }
    fn set_stop_chord(&mut self, chord: Option<&str>) -> BackendResult<()> {
        self.inner.set_stop_chord(chord)
    }
}

#[test]
fn an_object_mode_exec_whose_listing_fails_is_refused_with_nothing_sent() {
    let (inner, sink) = fake("");
    let mut session = object_session(Box::new(ListingFails { inner, fail: false }));
    let outcome = session.framed_click(None);
    let posts: Vec<String> = sink.lines().into_iter().filter(|l| l.starts_with("post_input")).collect();
    assert!(outcome.is_err(), "sent with the takeover gate off: {posts:?}");
    assert!(posts.is_empty(), "{posts:?}");
}
