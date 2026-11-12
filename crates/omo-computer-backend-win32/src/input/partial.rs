//! A partial `SendInput` (`sent < count`) releases only the downs of the accepted prefix that
//! have no up in it, last pressed first; nothing it did not insert is ever released (OMW-18).

use super::KeyUnit;

/// The ups that undo the unmatched downs among the first `sent` units of `batch`.
#[must_use]
pub fn releases_after(batch: &[KeyUnit], sent: usize) -> Vec<KeyUnit> {
    let mut held: Vec<KeyUnit> = Vec::new();
    for unit in batch.iter().take(sent) {
        if unit.down {
            held.push(*unit);
        } else if let Some(index) = held.iter().rposition(|down| down.same_key(unit)) {
            held.remove(index);
        }
    }
    held.iter().rev().map(|down| down.up()).collect()
}
