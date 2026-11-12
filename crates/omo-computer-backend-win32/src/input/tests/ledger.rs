//! The release helper's copy of the hold ledger: one line per press or release streamed over its
//! pipe, and the replay it runs when the engine dies (d-windows.md '## Input', RELEASE HELPER).

use crate::input::ledger::{replay, Entry, Ledger, Step};
use crate::input::{KeyUnit, VK_SHIFT};

const VK_A: u16 = 0x41;

#[test]
fn ledger_lines_round_trip() {
    for entry in [
        Entry::KeyDown(KeyUnit::virtual_key(VK_SHIFT, true)),
        Entry::KeyUp(KeyUnit::virtual_key(VK_SHIFT, false)),
        Entry::KeyDown(KeyUnit::unicode(0xD55C, true)),
        Entry::ButtonDown { button: 1, x: -20, y: 1080 },
        Entry::ButtonUp { button: 1 },
    ] {
        assert_eq!(Entry::parse(&entry.line()), Some(entry), "{}", entry.line());
    }
    assert_eq!(Entry::parse("K 1 nonsense"), None, "a malformed line is refused, never guessed");
}

#[test]
fn release_helper_releases_after_engine_kill() {
    let mut ledger = Ledger::default();
    for line in ["KD 16 0 0", "KD 65 0 0", "KU 65 0 0", "BD 1 300 200"] {
        ledger.apply(&Entry::parse(line).expect("line"));
    }
    // What the engine left down - Shift and the left button - is released, last pressed first; the
    // button goes up at its press origin.
    assert_eq!(
        replay(&ledger, &[]),
        vec![Step::Warp { x: 300, y: 200 }, Step::ButtonUp { button: 1 }, Step::KeyUp(KeyUnit::virtual_key(VK_SHIFT, false))]
    );
}

#[test]
fn replay_skips_a_key_the_user_holds_physically() {
    let mut ledger = Ledger::default();
    ledger.apply(&Entry::KeyDown(KeyUnit::virtual_key(VK_SHIFT, true)));
    ledger.apply(&Entry::KeyDown(KeyUnit::virtual_key(VK_A, true)));
    assert_eq!(replay(&ledger, &[VK_SHIFT]), vec![Step::KeyUp(KeyUnit::virtual_key(VK_A, false))]);
}
