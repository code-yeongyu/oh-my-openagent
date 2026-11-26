//! The held-input ledger (design row C9; `design/d-safety.md` '### 6. Stop commit,
//! fail-closed'): every `key.down` and `mouse.down` the session sends is recorded with its
//! press time (and, for a button, its press ORIGIN), bounded `0..=100 s`, and released on every
//! exit path the session owns. A held button is released by warping the pointer back to its
//! origin first, so an interrupted drag drops on its own source. A key the user holds
//! physically is never released synthetically.

use crate::backend::InputEvent;
use crate::params::{Button, Point};

/// The longest a key or a button may be held, in milliseconds.
pub const MAX_HOLD_MS: u64 = 100_000;

/// One held input.
#[derive(Debug, Clone, PartialEq)]
pub enum Held {
    Key { key: String },
    Button { button: Button, origin: Point },
}

#[derive(Debug, Clone, PartialEq)]
struct Entry {
    held: Held,
    since_ms: u64,
    /// The press's place in the session's press order (a bounded call releases from its mark).
    seq: u64,
}

/// One held input taken out of the ledger with the inputs that release it; a release the
/// backend refused goes back through [`HoldLedger::restore`] for the next exit path.
#[derive(Debug, Clone, PartialEq)]
pub struct Release {
    entry: Entry,
    pub events: Vec<InputEvent>,
}

/// Why the session releases what it holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitPath {
    Success,
    Error,
    Cancel,
    Deadline,
    Stop,
    ConnectionClose,
}

impl ExitPath {
    /// The six exit paths the session itself owns (SIGKILL and a silent link are released
    /// by the release helper and the brain-link deadline).
    pub const SESSION_OWNED: [Self; 6] = [
        Self::Success,
        Self::Error,
        Self::Cancel,
        Self::Deadline,
        Self::Stop,
        Self::ConnectionClose,
    ];
}

/// A hold request past the bound, refused before any input is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HoldTooLong {
    pub requested_ms: u64,
}

/// The inputs one session holds, in press order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HoldLedger {
    entries: Vec<Entry>,
    next_seq: u64,
}

impl HoldLedger {
    /// Checks a requested hold duration against the bound.
    ///
    /// # Errors
    /// [`HoldTooLong`] past [`MAX_HOLD_MS`], with nothing recorded.
    pub const fn admit(requested_ms: u64) -> Result<(), HoldTooLong> {
        if requested_ms > MAX_HOLD_MS {
            Err(HoldTooLong { requested_ms })
        } else {
            Ok(())
        }
    }

    pub fn press(&mut self, held: Held, now_ms: u64) {
        self.entries.push(Entry {
            held,
            since_ms: now_ms,
            seq: self.next_seq,
        });
        self.next_seq += 1;
    }

    /// The mark of the next press: [`Self::take_from`] with it takes exactly what was pressed
    /// after this point, never an earlier hold of the same key or button.
    #[must_use]
    pub const fn mark(&self) -> u64 {
        self.next_seq
    }

    /// Forgets one held input the caller released itself (`key.up`, `mouse.up`).
    pub fn lift(&mut self, held: &Held) -> bool {
        let found = self.entries.iter().rposition(|entry| same(&entry.held, held));
        found.map(|at| self.entries.remove(at)).is_some()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[must_use]
    pub fn held(&self) -> Vec<Held> {
        self.entries.iter().map(|entry| entry.held.clone()).collect()
    }

    /// The holds that reached the bound at `now_ms`.
    #[must_use]
    pub fn expired(&self, now_ms: u64) -> Vec<Held> {
        self.entries
            .iter()
            .filter(|entry| now_ms.saturating_sub(entry.since_ms) >= MAX_HOLD_MS)
            .map(|entry| entry.held.clone())
            .collect()
    }

    /// The clock time the oldest held input reaches the bound; `None` with nothing held.
    #[must_use]
    pub fn next_deadline(&self) -> Option<u64> {
        self.entries
            .iter()
            .map(|entry| entry.since_ms.saturating_add(MAX_HOLD_MS))
            .min()
    }

    /// Takes `which` out of the ledger and answers the inputs that release them, last press
    /// first, by the same plan as [`Self::release_all`]; every other hold stays held.
    pub fn release(&mut self, which: &[Held], user_held: &[String]) -> Vec<InputEvent> {
        flatten(self.take(|entry| which.iter().any(|held| same(&entry.held, held)), user_held))
    }

    /// Empties the ledger and answers the inputs that release it, last press first: a key-up
    /// for every key the user does not hold (`user_held`), and for every button a warp to
    /// its origin followed by the button-up. Every exit path takes this same plan.
    pub fn release_all(&mut self, user_held: &[String]) -> Vec<InputEvent> {
        flatten(self.take_all(user_held))
    }

    /// [`Self::release_all`], one [`Release`] per hold, last press first.
    pub fn take_all(&mut self, user_held: &[String]) -> Vec<Release> {
        self.take(|_| true, user_held)
    }

    /// The holds in `which`, one [`Release`] each, last press first.
    pub fn take_held(&mut self, which: &[Held], user_held: &[String]) -> Vec<Release> {
        self.take(|entry| which.iter().any(|held| same(&entry.held, held)), user_held)
    }

    /// The holds pressed at or after `mark` ([`Self::mark`]), one [`Release`] each, last press first.
    pub fn take_from(&mut self, mark: u64, user_held: &[String]) -> Vec<Release> {
        self.take(|entry| entry.seq >= mark, user_held)
    }

    /// Puts back a hold whose release the backend refused, in its press order, so the next
    /// exit path releases it again.
    pub fn restore(&mut self, release: Release) {
        let at = self.entries.partition_point(|entry| entry.seq < release.entry.seq);
        self.entries.insert(at, release.entry);
    }

    fn take(&mut self, which: impl Fn(&Entry) -> bool, user_held: &[String]) -> Vec<Release> {
        let (taken, kept): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut self.entries).into_iter().partition(which);
        self.entries = kept;
        taken
            .into_iter()
            .rev()
            .map(|entry| Release { events: release(entry.held.clone(), user_held), entry })
            .collect()
    }
}

fn flatten(releases: Vec<Release>) -> Vec<InputEvent> {
    releases.into_iter().flat_map(|release| release.events).collect()
}

fn same(a: &Held, b: &Held) -> bool {
    match (a, b) {
        (Held::Key { key: x }, Held::Key { key: y }) => x == y,
        (Held::Button { button: x, .. }, Held::Button { button: y, .. }) => x == y,
        (Held::Key { .. }, Held::Button { .. }) | (Held::Button { .. }, Held::Key { .. }) => false,
    }
}

fn release(held: Held, user_held: &[String]) -> Vec<InputEvent> {
    match held {
        Held::Key { key } if user_held.contains(&key) => Vec::new(),
        Held::Key { key } => vec![InputEvent::Key { key, down: false }],
        Held::Button { button, origin } => vec![
            InputEvent::PointerMove(origin),
            InputEvent::Button {
                button,
                down: false,
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: Point = Point { x: 10.0, y: 20.0 };

    fn key(name: &str) -> Held {
        Held::Key {
            key: name.to_owned(),
        }
    }

    #[test]
    fn the_bound_admits_100_s_and_refuses_past_it() {
        assert_eq!(HoldLedger::admit(0), Ok(()));
        assert_eq!(HoldLedger::admit(MAX_HOLD_MS), Ok(()));
        assert_eq!(
            HoldLedger::admit(MAX_HOLD_MS + 1),
            Err(HoldTooLong {
                requested_ms: 100_001
            })
        );
    }

    /// The ledger has ONE release plan whatever the exit path; the session's
    /// `held_key_released_on_each_of_six_session_exit_paths` drives each path.
    #[test]
    fn release_all_releases_every_hold_last_press_first() {
        let mut ledger = HoldLedger::default();
        ledger.press(key("shift"), 0);
        ledger.press(
            Held::Button {
                button: Button::Left,
                origin: ORIGIN,
            },
            5,
        );
        let released = ledger.release_all(&[]);
        assert_eq!(
            released,
            vec![
                InputEvent::PointerMove(ORIGIN),
                InputEvent::Button {
                    button: Button::Left,
                    down: false
                },
                InputEvent::Key {
                    key: "shift".to_owned(),
                    down: false
                },
            ]
        );
        assert!(ledger.is_empty());
    }

    #[test]
    fn release_takes_only_the_named_holds_and_the_deadline_follows_the_live_ones() {
        let mut ledger = HoldLedger::default();
        ledger.press(key("shift"), 0);
        ledger.press(key("a"), 10);
        assert_eq!(ledger.next_deadline(), Some(MAX_HOLD_MS));
        assert_eq!(
            ledger.release(&[key("shift")], &[]),
            vec![InputEvent::Key {
                key: "shift".to_owned(),
                down: false
            }]
        );
        assert_eq!(ledger.held(), vec![key("a")]);
        assert_eq!(ledger.next_deadline(), Some(10 + MAX_HOLD_MS));
    }

    #[test]
    fn a_key_the_user_holds_is_never_released_synthetically() {
        let mut ledger = HoldLedger::default();
        ledger.press(key("shift"), 0);
        ledger.press(key("a"), 0);
        let released = ledger.release_all(&["shift".to_owned()]);
        assert_eq!(
            released,
            vec![InputEvent::Key {
                key: "a".to_owned(),
                down: false
            }]
        );
    }

    #[test]
    fn a_lifted_hold_leaves_the_ledger_and_expiry_counts_from_the_press() {
        let mut ledger = HoldLedger::default();
        ledger.press(key("a"), 1_000);
        assert!(ledger.expired(100_999).is_empty());
        assert_eq!(ledger.expired(101_000), vec![key("a")]);
        assert!(ledger.lift(&key("a")));
        assert!(!ledger.lift(&key("a")));
        assert!(ledger.is_empty());
    }
}
