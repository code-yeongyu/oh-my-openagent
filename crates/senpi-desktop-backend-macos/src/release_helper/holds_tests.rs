use std::sync::{mpsc, Mutex};
use std::thread;

use super::holds::{transition, Transition, UserHolds};
use super::observe::{Observation, Transitions};
use super::plan::{hid_inputs, plan, Open, Step};
use super::wire::{Input, Route};

const SHIFT: u16 = 56;
const RIGHT_SHIFT: u16 = 60;
const OPTION: u16 = 58;
const A: u16 = 0;
const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const FLAGS_CHANGED: u32 = 12;

fn holding(inputs: &[Input]) -> UserHolds {
    let mut user = UserHolds::default();
    for &input in inputs {
        user.set(input, true);
    }
    user
}

fn hid_press(id: u32, code: u16) -> Open {
    Open { id, route: Route::Hid, input: Input::Key(code), text: None }
}

#[test]
fn transitions_read_the_engines_and_the_users_modifier_events() {
    let released = |kind, code, flags| transition(kind, code, flags, 0, |_| true);
    let fresh = |kind, code, flags| transition(kind, code, flags, 0, |_| false);
    let shift = Input::Key(SHIFT);
    // A process's own events carry only the shared flag.
    assert_eq!(fresh(FLAGS_CHANGED, SHIFT, 0x20000), Some(Transition::Press(shift)));
    assert_eq!(released(FLAGS_CHANGED, SHIFT, 0), Some(Transition::Release(shift)));
    // Releasing Shift while Option stays down still releases Shift.
    assert_eq!(released(FLAGS_CHANGED, SHIFT, 0x80000), Some(Transition::Release(shift)));
    // A modifier posted with no flags is up, even one not yet held.
    assert_eq!(fresh(FLAGS_CHANGED, SHIFT, 0), Some(Transition::Release(shift)));
    // Caps Lock has no modifier flag of its own, so it toggles.
    assert_eq!(fresh(FLAGS_CHANGED, 57, 0), Some(Transition::Press(Input::Key(57))));
    assert_eq!(released(FLAGS_CHANGED, 57, 0), Some(Transition::Release(Input::Key(57))));
    // Hardware: right Shift goes up while left Shift stays down, so the
    // shared flag is still set.
    assert_eq!(released(FLAGS_CHANGED, RIGHT_SHIFT, 0x20102), Some(Transition::Release(Input::Key(RIGHT_SHIFT))));
    assert_eq!(released(FLAGS_CHANGED, SHIFT, 0x20102), Some(Transition::Press(shift)));
    assert_eq!(fresh(KEY_DOWN, A, 0), Some(Transition::Press(Input::Key(A))));
    assert_eq!(fresh(KEY_UP, A, 0), Some(Transition::Release(Input::Key(A))));
    assert_eq!(fresh(6, 0, 0), Some(Transition::Move(Input::Button(0))));
    assert_eq!(fresh(4, 0, 0), Some(Transition::Release(Input::Button(1))));
    assert_eq!(transition(25, 0, 0, 3, |_| false), Some(Transition::Press(Input::Button(3))));
    assert_eq!(fresh(5, 0, 0), None);
}

/// A run loop that applies queued transitions only when drained, as the tap's
/// queue waits until the run loop gets to it.
struct Queued<'a> {
    observation: &'a Observation,
    queue: &'a Mutex<Vec<(Input, bool)>>,
}

impl Transitions for Queued<'_> {
    fn drain(&self) {
        for (input, down) in self.queue.lock().expect("queue").drain(..) {
            self.observation.holds().set(input, down);
        }
    }

    fn run_briefly(&self) {
        thread::yield_now();
    }
}

#[test]
fn ready_and_the_release_plan_see_the_users_queued_transitions() {
    let shift = Input::Key(SHIFT);
    let observation = &Observation::default();
    // The user pressed Shift while the holds were snapshotted.
    let queue = &Mutex::new(vec![(shift, true)]);
    let (ready, readied) = mpsc::channel();
    let (at_ready, planned) = thread::scope(|scope| {
        scope.spawn(move || {
            observation.follow(&Queued { observation, queue }, || {
                ready.send(*observation.holds()).expect("test waits");
            });
        });
        let at_ready = readied.recv().expect("READY");
        // The user lets go as the engine dies, before the run loop gets to it.
        queue.lock().expect("queue").push((shift, false));
        (at_ready, observation.settle())
    });
    assert!(at_ready.has(shift), "READY reports the queued press");
    assert!(!planned.has(shift), "the plan sees the queued release");
}

#[test]
fn holds_read_back_after_the_tap_missed_events_are_the_users_unless_a_press_holds_them() {
    let open = [hid_press(1, SHIFT), hid_press(2, A)];
    let mut holds = UserHolds::default();
    // The user held Option when the tap stopped. Unseen, they let go of it and
    // pressed right Shift, while this request pressed Shift and A.
    holds.set(Input::Key(OPTION), true);
    holds.resync(holding(&[Input::Key(RIGHT_SHIFT), Input::Key(SHIFT), Input::Key(A)]));
    // The user's right Shift keeps Shift, whose release would cut it short; A,
    // which only this request may hold, is released with the user's Shift and
    // without the Option they let go of.
    assert_eq!(plan(&open, holds.for_plan(hid_inputs(&open))), [
        Step::Post { id: 2, flags: Some(0x20000) },
        Step::Leave { id: 1 },
    ]);
    // A read-back hold whose release a process posts was that process's.
    let mut holds = holding(&[]);
    holds.resync(holding(&[Input::Key(OPTION)]));
    holds.posted_release(Input::Key(OPTION));
    assert!(!holds.for_plan(std::iter::empty()).has(Input::Key(OPTION)));
    // The user held A when the tap stopped, let go unseen, and this request
    // pressed A: still down, it is the request's press to release.
    let open = [hid_press(3, A)];
    let mut holds = holding(&[Input::Key(A)]);
    holds.resync(holding(&[Input::Key(A)]));
    assert_eq!(plan(&open, holds.for_plan(hid_inputs(&open))), [Step::Post { id: 3, flags: Some(0) }]);
    // A hold still down with no press of this request on it stays the user's.
    let mut holds = holding(&[Input::Key(A)]);
    holds.resync(holding(&[Input::Key(A)]));
    assert!(holds.for_plan(std::iter::empty()).has(Input::Key(A)));
}
