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
        });
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

    /// Empties the ledger and answers the inputs that release it, last press first: a key-up
    /// for every key the user does not hold (`user_held`), and for every button a warp to
    /// its origin followed by the button-up. Every exit path takes this same plan.
    pub fn release_all(&mut self, user_held: &[String]) -> Vec<InputEvent> {
        let entries = std::mem::take(&mut self.entries);
        entries
            .into_iter()
            .rev()
            .flat_map(|entry| release(entry.held, user_held))
            .collect()
    }
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

    #[test]
    fn every_session_exit_path_releases_every_hold_last_press_first() {
        for path in ExitPath::SESSION_OWNED {
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
                ],
                "{path:?}"
            );
            assert!(ledger.is_empty(), "{path:?}");
        }
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
