//! One background event to one addressed window (row 21a's `Route::BackgroundWindow{window}`):
//! the window must be live, the UIPI gate passes, the drop matrix admits the verb for the family
//! of the window that receives the post, and then every unit goes out through the one
//! `PostMessageW` site with `delivered{count, of}` counted per unit (a UTF-16 unit, a Return press,
//! a button, a wheel notch). A refusal sends nothing; a failure after the first unit reports the
//! units that went out. After the posts the consumption barrier runs on the receiving window.

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{Button, Point};

use crate::barrier::{consumed_hop, Barrier};
use crate::input::chords::posted_press;
use crate::input::text::background_chars;
use crate::input::vk::chord_of;
use crate::input::{Posted, WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP};

use super::family::{admit, family_of, Verb};
use super::integrity::admit_read;
use super::messages::{button, moved, notches, wheel, WHEEL_DELTA};
use super::target::{
    coordinate, key_target, window_of, ClientPoint, DeliveryOs, PostFailure, TARGET_UNKNOWN,
};

/// A button or wheel with no pointer position on this window yet.
const NO_POINT: Refusal = Refusal::new(EngineCode::InputFailed, Reason::NoRegion);
const UNSUPPORTED: Refusal = Refusal::new(EngineCode::Internal, Reason::InputUnsupported);

/// The background deliverer of one backend: the last pointer position per window (a click is a
/// move, then a press and a release) and the last barrier result.
#[derive(Debug, Default)]
pub struct Deliverer {
    pointer: Option<(isize, Point)>,
    last: Option<Barrier>,
}

impl Deliverer {
    /// The barrier result of the last delivered verb (`None` before any, or after a move).
    #[must_use]
    pub const fn last_barrier(&self) -> Option<Barrier> {
        self.last
    }

    /// Delivers `event` to the window `window` names.
    ///
    /// # Errors
    /// `BackgroundUnavailable{target_unknown}` for a window that is not live, `PermissionDenied`
    /// above the engine, the family refusal of the drop matrix, `InputFailed{no_region}` for a
    /// button with no position, all with nothing sent; `Internal{input_unsupported}` for an event
    /// this route does not carry.
    pub fn deliver(
        &mut self,
        os: &mut dyn DeliveryOs,
        window: &str,
        event: &InputEvent,
    ) -> BackendResult<Delivered> {
        let top = window_of(window)
            .filter(|top| os.alive(*top))
            .ok_or(TARGET_UNKNOWN)?;
        admit_read(os.integrity(top))?;
        self.last = None;
        match event {
            InputEvent::Text(text) => {
                let target = admitted_key_target(os, top, Verb::Text)?;
                self.send(os, target, &units(&background_chars(text)), true)
            }
            InputEvent::Key { key, down } => self.key(os, top, key, *down),
            InputEvent::PointerMove(at) => {
                let (child, client) = admitted_child(os, top, *at, Verb::Move)?;
                let sent = self.send(os, child, &[vec![moved(client)]], false)?;
                self.pointer = Some((top, *at));
                Ok(sent)
            }
            InputEvent::Button {
                button: which,
                down,
            } => {
                let at = self.position(top)?;
                let (child, client) = admitted_child(os, top, at, click_verb(*which))?;
                self.send(os, child, &[vec![button(*which, *down, client)]], !down)
            }
            InputEvent::Scroll { dx, dy } => self.scroll(os, top, *dx, *dy),
            _ => Err(UNSUPPORTED),
        }
    }

    fn key(
        &mut self,
        os: &mut dyn DeliveryOs,
        top: isize,
        key: &str,
        down: bool,
    ) -> BackendResult<Delivered> {
        let chord =
            chord_of(key).map_err(|_| Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey))?;
        let m = chord.mods;
        let named = matches!(chord.key, crate::input::chords::Key::Named(_));
        let verb = if m.ctrl || m.win || (m.shift && named) {
            Verb::ModifierChord
        } else {
            Verb::Key
        };
        let target = admitted_key_target(os, top, verb)?;
        let half: Vec<Posted> = posted_press(&chord)?
            .into_iter()
            .filter(|message| {
                if down {
                    matches!(message.msg, WM_KEYDOWN | WM_SYSKEYDOWN | WM_CHAR)
                } else {
                    matches!(message.msg, WM_KEYUP | WM_SYSKEYUP)
                }
            })
            .collect();
        if half.is_empty() {
            // A character's release has no posted form: its WM_CHAR went out with the press.
            return Ok(Delivered { count: 1, of: 1 });
        }
        self.send(os, target, &[half], !down)
    }

    fn scroll(
        &mut self,
        os: &mut dyn DeliveryOs,
        top: isize,
        dx: f64,
        dy: f64,
    ) -> BackendResult<Delivered> {
        let at = self.position(top)?;
        let (child, _) = admitted_child(os, top, at, Verb::Scroll)?;
        let screen = screen_point(at).ok_or(NO_POINT)?;
        let (horizontal, distance) = if dy == 0.0 { (true, dx) } else { (false, dy) };
        // A positive distance scrolls down (or right): the wheel turns toward the user.
        let delta = if (distance > 0.0) == horizontal {
            WHEEL_DELTA
        } else {
            -WHEEL_DELTA
        };
        let notch = vec![wheel(horizontal, delta, screen)];
        let all: Vec<Vec<Posted>> = (0..notches(distance)).map(|_| notch.clone()).collect();
        self.send(os, child, &all, true)
    }

    fn position(&self, top: isize) -> Result<Point, Refusal> {
        self.pointer
            .filter(|(on, _)| *on == top)
            .map(|(_, at)| at)
            .ok_or(NO_POINT)
    }

    /// Posts every unit in order; the barrier runs on `target` after a verb that completes one.
    fn send(
        &mut self,
        os: &mut dyn DeliveryOs,
        target: isize,
        all: &[Vec<Posted>],
        barrier: bool,
    ) -> BackendResult<Delivered> {
        let of = u32::try_from(all.len()).unwrap_or(u32::MAX);
        let mut count = 0;
        for unit in all {
            if let Err(failure) = unit.iter().try_for_each(|message| os.post(target, message)) {
                if count == 0 {
                    return Err(refusal_of(failure));
                }
                return Ok(Delivered { count, of });
            }
            count += 1;
        }
        if barrier {
            self.last = Some(consumed_hop(os, target));
        }
        Ok(Delivered { count, of })
    }
}

const fn click_verb(which: Button) -> Verb {
    match which {
        Button::Left => Verb::LeftClick,
        Button::Right => Verb::RightClick,
        Button::Middle => Verb::MiddleClick,
    }
}

fn admitted_key_target(os: &dyn DeliveryOs, top: isize, verb: Verb) -> Result<isize, Refusal> {
    let target = key_target(os, top)?;
    admit(family_of(&os.class(target).unwrap_or_default()), verb)
        .map_err(|refused| refused.refusal)?;
    Ok(target)
}

fn admitted_child(
    os: &dyn DeliveryOs,
    top: isize,
    at: Point,
    verb: Verb,
) -> Result<(isize, ClientPoint), Refusal> {
    let (child, client) = os.child_at(top, at).ok_or(NO_POINT)?;
    admit(family_of(&os.class(child).unwrap_or_default()), verb)
        .map_err(|refused| refused.refusal)?;
    Ok((child, client))
}

/// A Return press (down + up) is one unit; every other message is one.
fn units(messages: &[Posted]) -> Vec<Vec<Posted>> {
    let mut out: Vec<Vec<Posted>> = Vec::new();
    for message in messages {
        match out.last_mut() {
            Some(open)
                if message.msg == WM_KEYUP
                    && open.first().is_some_and(|first| first.msg == WM_KEYDOWN) =>
            {
                open.push(*message);
            }
            _ => out.push(vec![*message]),
        }
    }
    out
}

fn screen_point(at: Point) -> Option<ClientPoint> {
    Some(ClientPoint {
        x: coordinate(at.x)?,
        y: coordinate(at.y)?,
    })
}

const fn refusal_of(failure: PostFailure) -> Refusal {
    match failure {
        PostFailure::AccessDenied => super::integrity::ABOVE_ENGINE,
        PostFailure::Failed => Refusal::bare(EngineCode::InputFailed),
    }
}
