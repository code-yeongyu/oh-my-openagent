//! One mutating call as the funnel takes it, and its builders.

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::frame::FrameRefusal;
use omo_computer_core::methods::Method;
use omo_computer_core::requests::CallAuthority;
use omo_computer_safety::Call;

/// One mutating call as the funnel takes it.
pub struct Mutation<'a> {
    pub method: Method,
    pub call: Call<'a>,
    pub events: Vec<InputEvent>,
    pub route: Route,
    pub call_id: Option<String>,
    pub run_generation: Option<u64>,
    pub frame_id: Option<String>,
    /// Typed text: the marker and the audit keep its length (and digest outside a secure focus).
    pub text: Option<String>,
    pub keys: Vec<String>,
    /// The frame check's verdict on the call's coordinates: refused after the safety gate,
    /// before anything is sent.
    pub frame_refusal: Option<FrameRefusal>,
    /// `consume:true`: the `(target, frameId)` a delivery consumes.
    pub consume: Option<(String, String)>,
}

impl<'a> Mutation<'a> {
    /// An exec request's call, bound to its `callId` and `runGeneration`.
    #[must_use]
    pub fn exec(
        method: Method,
        call: Call<'a>,
        events: Vec<InputEvent>,
        route: Route,
        authority: &CallAuthority,
    ) -> Self {
        Self {
            method,
            call,
            events,
            route,
            call_id: authority.call_id.clone(),
            run_generation: authority.run_generation,
            frame_id: None,
            text: None,
            keys: Vec::new(),
            frame_refusal: None,
            consume: None,
        }
    }

    /// A v1 text call: no `callId` on the wire, so the funnel mints one.
    #[must_use]
    pub fn typed(method: Method, call: Call<'a>, route: Route, text: String) -> Self {
        Self {
            method,
            call,
            events: vec![InputEvent::Text(text.clone())],
            route,
            call_id: None,
            run_generation: None,
            frame_id: None,
            text: Some(text),
            keys: Vec::new(),
            frame_refusal: None,
            consume: None,
        }
    }

    #[must_use]
    pub fn with_frame(mut self, frame_id: Option<String>) -> Self {
        self.frame_id = frame_id;
        self
    }

    #[must_use]
    pub fn with_frame_check(
        mut self,
        refusal: Option<FrameRefusal>,
        consume: Option<(String, String)>,
    ) -> Self {
        self.frame_refusal = refusal;
        self.consume = consume;
        self
    }

    #[must_use]
    pub fn with_keys(mut self, keys: Vec<String>) -> Self {
        self.keys = keys;
        self
    }
}
