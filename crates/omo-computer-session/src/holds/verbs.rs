//! The hold verbs (design row C9): `mouse.down/up`, `key.down/up`, and the bounded v1
//! `holdKeys`/`holdMouse`. Every hold goes through the funnel on the foreground route (holds
//! require `delivery:"foreground"`, so a hold needs the foreground lease) and enters the ledger;
//! a held button records its press origin. The bounded calls release on every way out of the
//! call (success, error); stop, revoke and close release through the lease hook, and the
//! 100 s bound through the serve loop's deadline (R49).

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::holds::{Held, HoldLedger};
use omo_computer_core::keys::chord_keys;
use omo_computer_core::methods::Method;
use omo_computer_core::params::{
    Button, HoldKeysParams, HoldMouseParams, KeyDownParams, KeyUpParams, MouseDownParams, MouseUpParams, Point,
};
use omo_computer_core::requests::{At, CallAuthority};
use omo_computer_core::results::ExecReply;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use super::hold_duration;
use crate::frames::{frame_key, FrameCheck};
use crate::mutate::{key_event, Mutation, Refused};
use crate::{Session, POINT_REQUIRED};

const BAD_KEY: omo_computer_core::backend::Refusal =
    omo_computer_core::backend::Refusal::bare(omo_computer_core::error::EngineCode::InvalidKey);

impl Session {
    pub(crate) fn clock_ms(&self) -> u64 {
        self.backend.clock().map_or(0, omo_computer_core::intervention::BackendClock::now_ms)
    }

    fn session_tag(&self) -> u64 {
        self.opened.as_ref().map_or(0, |opened| opened.tag)
    }

    fn hold_call(&mut self, method: Method, target: &str, call: (Vec<Point>, Option<String>, bool), events: Vec<InputEvent>, frame: (Option<String>, FrameCheck), authority: &CallAuthority) -> Result<ExecReply, Refused> {
        let (points, chord, force) = call;
        let dispatched = serde_json::json!({ "target": target, "chord": chord });
        let call = Call { verb: if points.is_empty() { VerbKind::Keyboard } else { VerbKind::Pointer }, target: TargetRef::read(Some(target)), points, chord, force };
        let (frame_id, (refusal, consume)) = frame;
        let mutation = Mutation::exec(method, call, events, Route::ForegroundHid, authority)
            .with_frame(frame_id)
            .with_frame_check(refusal, consume);
        self.traced(dispatched, &frame_key(Some(target)), mutation)
    }

    /// The press point and its frame check: the frame's mapping of `at`, or the pointer.
    fn press_point(&mut self, target: &str, at: Option<At>, frame_id: Option<&str>) -> Result<(Point, FrameCheck), Refused> {
        match at {
            Some(at) => {
                let (_, point, check) = self.frame_for(Some(target), frame_id, at, false);
                Ok((point, check))
            }
            None => self.backend.pointer().map(|point| (point, (None, None))).ok_or_else(|| Refused::from(POINT_REQUIRED)),
        }
    }

    /// The units a refused send got out before it stopped.
    fn sent_before(result: &Result<ExecReply, Refused>) -> usize {
        result.as_ref().err().and_then(|refused| refused.stamps.delivered).map_or(usize::MAX, |d| usize::try_from(d.count).unwrap_or(usize::MAX))
    }

    fn already_released(&self, method: Method) -> Result<ExecReply, Refused> {
        let mode = self.opened.as_ref().map(|opened| opened.report_mode).ok_or_else(|| Refused::from(crate::NOT_OPEN))?;
        crate::mutate::released_reply(mode, method)
    }

    /// `mouse.down`: the button goes down at the point (or where the pointer is) and enters
    /// the ledger with that point as its press origin.
    ///
    /// # Errors
    /// The frame check or the funnel's refusal.
    pub fn mouse_down(&mut self, params: MouseDownParams) -> Result<ExecReply, Refused> {
        let button = params.button.unwrap_or(Button::Left);
        let at = params.x.zip(params.y).map(|(x, y)| At { x, y });
        let (origin, check) = self.press_point(&params.target, at, params.frame_id.as_deref())?;
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let events = vec![InputEvent::PointerMove(origin), InputEvent::Button { button, down: true }];
        let result = self.hold_call(Method::MouseDown, &params.target, (vec![origin], None, false), events, (params.frame_id.clone(), check), &authority);
        if result.is_ok() || Self::sent_before(&result) >= 2 {
            self.funnel.control.holds.press(Held::Button { button, origin }, self.clock_ms(), self.session_tag());
        }
        result
    }

    /// `mouse.up`: the warp to the press origin and the button-up; a hold the ledger already
    /// released at the bound answers `partial` with nothing sent (R49).
    ///
    /// # Errors
    /// The funnel's refusal.
    pub fn mouse_up(&mut self, params: MouseUpParams) -> Result<ExecReply, Refused> {
        let button = params.button.unwrap_or(Button::Left);
        let origin = self.funnel.control.holds.held().into_iter().find_map(|held| match held {
            Held::Button { button: b, origin } if b == button => Some(origin),
            Held::Button { .. } | Held::Key { .. } => None,
        });
        let Some(origin) = origin else {
            return self.already_released(Method::MouseUp);
        };
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let events = vec![InputEvent::PointerMove(origin), InputEvent::Button { button, down: false }];
        let reply = self.hold_call(Method::MouseUp, &params.target, (vec![origin], None, false), events, (None, (None, None)), &authority)?;
        self.funnel.control.holds.lift(&Held::Button { button, origin });
        Ok(reply)
    }

    /// `key.down`: every key of the chord goes down, in order, and enters the ledger.
    ///
    /// # Errors
    /// `InvalidKey` for a chord that does not parse, or the funnel's refusal.
    pub fn key_down(&mut self, params: KeyDownParams) -> Result<ExecReply, Refused> {
        let keys = chord_keys(&params.chord).map_err(|_| Refused::from(BAD_KEY))?;
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let events = keys.iter().map(|key| key_event(key, true)).collect();
        let force = params.force.unwrap_or(false);
        let result = self.hold_call(Method::KeyDown, &params.target, (Vec::new(), Some(params.chord.clone()), force), events, (params.frame_id.clone(), (None, None)), &authority);
        let (now, tag) = (self.clock_ms(), self.session_tag());
        keys.into_iter().take(Self::sent_before(&result)).for_each(|key| self.funnel.control.holds.press(Held::Key { key }, now, tag));
        result
    }

    /// `key.up`: the chord's keys come up in reverse order; keys the ledger already released
    /// at the bound answer `partial` with nothing sent.
    ///
    /// # Errors
    /// `InvalidKey` for a chord that does not parse, or the funnel's refusal.
    pub fn key_up(&mut self, params: KeyUpParams) -> Result<ExecReply, Refused> {
        let keys = chord_keys(&params.chord).map_err(|_| Refused::from(BAD_KEY))?;
        let held = self.funnel.control.holds.held();
        if !keys.iter().any(|key| held.contains(&Held::Key { key: key.clone() })) {
            return self.already_released(Method::KeyUp);
        }
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let events = keys.iter().rev().map(|key| key_event(key, false)).collect();
        let reply = self.hold_call(Method::KeyUp, &params.target, (Vec::new(), Some(params.chord.clone()), false), events, (None, (None, None)), &authority)?;
        keys.into_iter().for_each(|key| {
            self.funnel.control.holds.lift(&Held::Key { key });
        });
        Ok(reply)
    }

    /// v1 `holdKeys`: the keys go down, stay down `duration` ms on the backend clock, and come
    /// up on every way out of the call.
    ///
    /// # Errors
    /// `InvalidArguments{hold_duration}` past 100 s, `InvalidKey`, or the funnel's refusal.
    pub fn hold_keys(&mut self, params: HoldKeysParams) -> Result<ExecReply, Refused> {
        HoldLedger::admit(params.duration).map_err(|_| hold_duration())?;
        let chord = params.keys.join("+");
        let down = self.key_down(KeyDownParams { target: params.target.clone(), chord, frame_id: None, force: None, call_id: None, run_generation: None, observe_after: None });
        self.hold_then_release(params.duration, down)
    }

    /// v1 `holdMouse`: the left button goes down at the point, stays down `duration` ms, and
    /// comes up at its origin on every way out of the call.
    ///
    /// # Errors
    /// `InvalidArguments{hold_duration}` past 100 s, or the funnel's refusal.
    pub fn hold_mouse(&mut self, params: HoldMouseParams) -> Result<ExecReply, Refused> {
        HoldLedger::admit(params.duration).map_err(|_| hold_duration())?;
        let down = self.mouse_down(MouseDownParams { target: params.target.clone(), button: None, x: Some(params.x), y: Some(params.y), frame_id: None, call_id: None, run_generation: None, observe_after: None });
        self.hold_then_release(params.duration, down)
    }

    fn hold_then_release(&mut self, duration_ms: u64, down: Result<ExecReply, Refused>) -> Result<ExecReply, Refused> {
        if down.is_ok() {
            if let Some(clock) = self.backend.clock() {
                clock.wait_ms(duration_ms);
            }
        }
        self.funnel.control.holds.release_all(self.backend.as_mut());
        down
    }
}
