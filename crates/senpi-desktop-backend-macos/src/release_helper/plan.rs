//! Which presses the helper still holds open, and what it does with each once
//! the stream ends. Ported from oh-my-pi `desktop/macos/release.rs` (MIT).

use super::holds::{modifier, UserHolds};
use super::wire::{Input, Record, Route};

/// A press the helper still holds open, in press order.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Open {
    pub(crate) id: u32,
    pub(crate) route: Route,
    pub(crate) input: Input,
    pub(crate) text: Option<String>,
}

/// Applies `record` to the open presses.
pub(crate) fn apply(open: &mut Vec<Open>, record: Record) {
    match record {
        Record::Hello { .. } | Record::Observe => {}
        Record::Press { id, route, input, text } => open.push(Open { id, route, input, text }),
        Record::Update { id, route } => {
            if let Some(press) = open.iter_mut().find(|press| press.id == id) {
                press.route = route;
            }
        }
        Record::Release { id } => open.retain(|press| press.id != id),
    }
}

/// What the helper does with one open press.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// Post the press's release; a key release carries `flags`.
    Post { id: u32, flags: Option<u64> },
    /// Leave the press to the user, who holds the same key or button on the
    /// shared HID route: their own release ends it, and posting one would cut
    /// their hold short.
    Leave { id: u32 },
}

/// The releases of `open` (in press order), latest press first, as the
/// in-process cleanup posts them. Per-process routes reach only the target
/// and always release. A key release carries the modifiers still held on its
/// lane, plus on the HID route the ones the user holds.
pub(crate) fn plan(open: &[Open], user: UserHolds) -> Vec<Step> {
    open.iter()
        .enumerate()
        .rev()
        .map(|(index, press)| {
            let hid = press.route == Route::Hid;
            if hid && user.holds(press.input) {
                return Step::Leave { id: press.id };
            }
            let flags = matches!(press.input, Input::Key(_)).then(|| {
                let held = open[..index]
                    .iter()
                    .filter(|earlier| earlier.route.lane() == press.route.lane())
                    .filter_map(|earlier| match earlier.input {
                        Input::Key(code) => modifier(code).map(|(flag, _)| flag),
                        Input::Button(_) => None,
                    })
                    .fold(0, |flags, flag| flags | flag);
                if hid { held | user.flags() } else { held }
            });
            Step::Post { id: press.id, flags }
        })
        .collect()
}

/// The HID-route inputs of `open`, whose unsure user holds a plan takes for
/// this request's presses.
pub(crate) fn hid_inputs(open: &[Open]) -> impl Iterator<Item = Input> + '_ {
    open.iter().filter(|press| press.route == Route::Hid).map(|press| press.input)
}
