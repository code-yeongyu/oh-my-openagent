//! An object-mode session over the fake backend, with the stop path armed, behind a wrapper
//! that counts `windows()` listings.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
};
use omo_computer_core::ax::AxReader;
use omo_computer_core::backend::{
    Backend, BackendClock, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes,
    PermissionProbe, Presence, Route, SettleSource, StopListener, TaggedInput, Target,
    WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::results::{DisplayInfo, ExecReply};
use serde_json::{json, Value};

use super::params;
use crate::{Refused, Session};

/// Two Notes windows: the document 101 and the dialog 102 titled "Save".
const BASE: &str = r#"{
  "displays": [{"id": "1", "name": "Built-in Display", "x": 0, "y": 0, "width": 1920, "height": 1080, "scale": 1.0, "pixelX": 0, "pixelY": 0, "pixelWidth": 1920, "pixelHeight": 1080, "isPrimary": true}],
  "windows": [
    {"id": "101", "title": "Untitled - Notes", "app": "Notes", "pid": 4242, "x": 100, "y": 120, "width": 800, "height": 600, "focused": true, "elevated": null},
    {"id": "102", "title": "Save", "app": "Notes", "pid": 4242, "x": 300, "y": 300, "width": 300, "height": 200, "focused": false, "elevated": null}
  ],
  "ax": {
    "101": {"role": "window", "native_role": "AXWindow", "title": "Untitled - Notes", "children": [{"role": "button", "native_role": "AXButton", "title": "Bold", "actions": ["press"]}]},
    "102": {"role": "window", "native_role": "AXWindow", "title": "Save", "children": [{"role": "button", "native_role": "AXButton", "title": "Save", "actions": ["press"]}]}
  }
}"#;

/// The fake behind a wrapper that counts `windows()` listings.
struct Counting {
    inner: FakeBackend,
    windows: Arc<AtomicU32>,
    /// Listings from this one on (1-based) are refused with `fail_with`; 0 never refuses.
    fail_from: Arc<AtomicU32>,
    fail_with: Arc<std::sync::Mutex<omo_computer_core::backend::Refusal>>,
}

impl Backend for Counting {
    // Row 21 (R70bc): forward the consent view, platform and stop chord to the wrapped fake.
    fn host_consent(&self) -> Option<serde_json::Value> {
        self.inner.host_consent()
    }

    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        self.inner.platform()
    }

    fn set_stop_chord(&mut self, chord: Option<&str>) -> omo_computer_core::backend::BackendResult<()> {
        self.inner.set_stop_chord(chord)
    }

    fn capabilities(&self) -> Capabilities {
        Backend::capabilities(&self.inner)
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        let nth = self.windows.fetch_add(1, Ordering::SeqCst) + 1;
        let fail_from = self.fail_from.load(Ordering::SeqCst);
        if fail_from > 0 && nth >= fail_from {
            return Err(self
                .fail_with
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone());
        }
        Backend::windows(&mut self.inner, filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        Backend::displays(&mut self.inner)
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        Backend::capture(&mut self.inner, target, options)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        Backend::post_input(&mut self.inner, input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        Backend::stop_listener(&mut self.inner)
    }

    fn probe_permissions(&self) -> PermissionProbe {
        Backend::probe_permissions(&self.inner)
    }

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        Backend::epoch_source(&mut self.inner)
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        Backend::presence(&mut self.inner)
    }

    fn ax_reader(&mut self) -> Option<&mut dyn AxReader> {
        Backend::ax_reader(&mut self.inner)
    }

    fn clock(&self) -> Option<&dyn BackendClock> {
        Backend::clock(&self.inner)
    }

    fn settle_source(&mut self) -> Option<Box<dyn SettleSource>> {
        Backend::settle_source(&mut self.inner)
    }
}

pub struct Rig {
    pub session: Session,
    pub clock: FakeClock,
    pub sink: RecordingSink,
    pub windows: Arc<AtomicU32>,
    fail_from: Arc<AtomicU32>,
    fail_with: Arc<std::sync::Mutex<omo_computer_core::backend::Refusal>>,
}

impl Rig {
    /// The base scenario with `extra`'s top-level keys added.
    pub fn new(extra: Value) -> Self {
        let mut scenario: Value = serde_json::from_str(BASE).expect("base scenario JSON");
        if let (Some(map), Value::Object(extra)) = (scenario.as_object_mut(), extra) {
            map.extend(extra);
        }
        let scenario = FakeScenario::from_value(&scenario).expect("scenario");
        let (clock, sink) = (FakeClock::default(), RecordingSink::default());
        let fake = FakeBackend::with_parts(scenario, clock.clone(), sink.clone())
            .with_stop_path(StopPathScript::Live);
        let windows = Arc::new(AtomicU32::new(0));
        let fail_from = Arc::new(AtomicU32::new(0));
        let fail_with = Arc::new(std::sync::Mutex::new(
            omo_computer_core::backend::Refusal::bare(
                omo_computer_core::error::EngineCode::Internal,
            ),
        ));
        let backend = Counting {
            inner: fake,
            windows: windows.clone(),
            fail_from: fail_from.clone(),
            fail_with: fail_with.clone(),
        };
        let mut session = Session::new(Box::new(backend));
        session
            .open(params(json!({"reportMode": "object"})))
            .expect("open");
        session.stop_path_start(params(json!({})));
        Self {
            session,
            clock,
            sink,
            windows,
            fail_from,
            fail_with,
        }
    }

    /// Listings from the `nth` one after now on are refused with `refusal`.
    pub fn refuse_listings_after(&self, nth: u32, refusal: omo_computer_core::backend::Refusal) {
        *self
            .fail_with
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = refusal;
        self.fail_listings_after(nth);
    }

    /// Listings from the `nth` one after now on are refused `Internal`.
    pub fn fail_listings_after(&self, nth: u32) {
        let done = self.windows.load(Ordering::SeqCst);
        self.fail_from.store(done + nth, Ordering::SeqCst);
    }

    /// A frame of 101, then a click on it.
    pub fn click(&mut self) -> Result<ExecReply, Refused> {
        self.session
            .capture_frame("101", true, None)
            .expect("a frame of 101");
        self.session
            .click(params(json!({"target": "101", "x": 10, "y": 10})))
    }

    pub fn listings(&self) -> u32 {
        self.windows.load(Ordering::SeqCst)
    }
}
