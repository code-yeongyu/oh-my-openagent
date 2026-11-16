//! The pointer verbs of row 23 (design row C9): `move`, `scroll` (bounded, counted wheel
//! steps), `drag{from,to,path[]}` and the read `pointer()`. `drag` sends every point through
//! the effective-target check (row 16's every-point rule), holds its button in the ledger with
//! `from` as the press origin, and consumes its frame once; a send stopped mid-drag releases
//! the button at the origin, so the drag drops on its own source.

use omo_computer_core::backend::{InputEvent, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::holds::Held;
use omo_computer_core::methods::Method;
use omo_computer_core::params::{Button, DragParams, MoveParams, Point, ScrollParams};
use omo_computer_core::pointer::ScrollAsk;
use omo_computer_core::report::Platform;
use omo_computer_core::requests::{At, CallAuthority};
use omo_computer_core::results::{ExecReply, PointerPosition};
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::holds::scroll_steps;
use crate::mutate::{key_event, route_for, Mutation, Refused};
use crate::Session;

fn pointer_call(target: &str, points: Vec<Point>) -> Call<'_> {
    Call { verb: VerbKind::Pointer, target: TargetRef::read(Some(target)), points, chord: None, force: false }
}

impl Session {
    /// `move`: the pointer goes to the point; nothing is pressed.
    ///
    /// # Errors
    /// The funnel's refusal.
    pub fn move_pointer(&mut self, params: MoveParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let (key, point, (refusal, consume)) = self.frame_for(Some(&params.target), params.frame_id.as_deref(), At { x: params.x, y: params.y }, false);
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let mutation = Mutation::exec(Method::Move, pointer_call(&params.target, vec![point]), vec![InputEvent::PointerMove(point)], Route::ForegroundHid, &authority)
            .with_frame(params.frame_id.clone())
            .with_frame_check(refusal, consume);
        self.traced(dispatched, &key, mutation)
    }

    /// `scroll`: the pointer goes to the point and the wheel turns one counted step per event,
    /// at most `MAX_SCROLL_STEPS` clicks (refused past it); a pixel delta is one event whose
    /// steps and per-route cap are the backend's, and the report counts what it delivered.
    ///
    /// # Errors
    /// `InvalidArguments{scroll_steps}`, or the funnel's refusal.
    pub fn scroll(&mut self, params: ScrollParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let ask = ScrollAsk::read(params.dx, params.dy, params.clicks, params.direction);
        let steps = ask.steps().map_err(|_| scroll_steps("clicks"))?;
        let (key, point, (refusal, consume)) = self.frame_for(Some(&params.target), None, At { x: params.x, y: params.y }, false);
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let mut events = vec![InputEvent::PointerMove(point)];
        events.extend(steps);
        let route = route_for(Some(&params.target), params.delivery);
        let mutation = Mutation::exec(Method::Scroll, pointer_call(&params.target, vec![point]), events, route, &authority)
            .with_frame_check(refusal, consume);
        self.traced(dispatched, &key, mutation)
    }

    /// `drag`: press at `from`, move through `path[]` to `to`, release there.
    ///
    /// # Errors
    /// The frame check of any point, the effective-target check of any point, or the funnel's
    /// refusal; a send stopped after the press releases the button at `from` first.
    pub fn drag(&mut self, params: DragParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let target = params.target.clone();
        let frame_id = params.frame_id.as_deref();
        let asked: Vec<Point> = std::iter::once(params.from).chain(params.path.clone().unwrap_or_default()).chain(std::iter::once(params.to)).collect();
        let last = asked.len() - 1;
        let mut points = Vec::with_capacity(asked.len());
        let (mut key, mut check) = (String::new(), (None, None));
        for (index, at) in asked.iter().enumerate() {
            let (frame_key, point, (refusal, consume)) = self.frame_for(Some(&target), frame_id, At { x: at.x, y: at.y }, index == last);
            if check.0.is_none() {
                check.0 = refusal;
            }
            if index == last {
                check.1 = consume;
            }
            key = frame_key;
            points.push(point);
        }
        let button = params.button.unwrap_or(Button::Left);
        let modifiers = params.modifiers.clone().unwrap_or_default();
        let origin = points[0];
        let mut events: Vec<InputEvent> = vec![InputEvent::PointerMove(origin)];
        events.extend(modifiers.iter().map(|key| key_event(key, true)));
        let pressed_at = events.len();
        events.push(InputEvent::Button { button, down: true });
        events.extend(points[1..].iter().map(|point| InputEvent::PointerMove(*point)));
        let released_at = events.len();
        events.push(InputEvent::Button { button, down: false });
        events.extend(modifiers.iter().rev().map(|key| key_event(key, false)));
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let mutation = Mutation::exec(Method::Drag, pointer_call(&target, points), events, Route::ForegroundHid, &authority)
            .with_frame(params.frame_id.clone())
            .with_frame_check(check.0, check.1)
            .with_keys(modifiers.clone());
        let result = self.traced(dispatched, &key, mutation);
        if result.is_err() {
            let sent = Self::sent_before(&result);
            let stuck = stuck_after(sent, &modifiers, (pressed_at, released_at), Held::Button { button, origin });
            let tag = self.opened.as_ref().map_or(0, |opened| opened.tag);
            for held in &stuck {
                self.funnel.control.holds.press(held.clone(), 0, tag);
            }
            self.funnel.control.holds.release(self.backend.as_mut(), &stuck);
        }
        result
    }

    /// `pointer()`: where the pointer is, read without posting anything.
    ///
    /// # Errors
    /// A Wayland hand with no position yet (its last libei position, before the first motion):
    /// `Internal{wayland_no_pointer_read}`, whose next call moves the pointer (#13906). Any other
    /// hand that cannot read the pointer: `Internal`.
    pub fn pointer(&self) -> Result<PointerPosition, Refusal> {
        let Some(p) = self.backend.pointer() else {
            return Err(match self.backend.platform() {
                Some(Platform::Wayland) => Refusal::new(EngineCode::Internal, Reason::WaylandNoPointerRead),
                _ => Refusal::bare(EngineCode::Internal),
            });
        };
        Ok(PointerPosition { x: p.x, y: p.y })
    }
}

/// What a drag stopped after `sent` events left down: each modifier whose down went out and
/// whose up did not, and the button between its down (`pressed_at`) and its up (`released_at`).
fn stuck_after(sent: usize, modifiers: &[String], (pressed_at, released_at): (usize, usize), button: Held) -> Vec<Held> {
    let mut stuck: Vec<Held> = modifiers
        .iter()
        .enumerate()
        .filter(|(index, _)| sent > 1 + index && sent <= released_at + modifiers.len() - index)
        .map(|(_, key)| Held::Key { key: key.clone() })
        .collect();
    if sent > pressed_at && sent <= released_at {
        stuck.push(button);
    }
    stuck
}
