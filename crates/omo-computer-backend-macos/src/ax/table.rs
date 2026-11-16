//! The element table of a live AX server: one id per distinct `AXUIElement`. AX hands out a
//! new reference for the same element on every read, so the server interns each reference by
//! its hash and equality (`CFHash` / `CFEqual` on macOS): the same element keeps one id across
//! reads, the table holds one entry per element, and a destroyed element is removed.

use std::collections::BTreeMap;

use super::seam::Element;

/// Interned values with stable ids.
#[derive(Debug)]
pub struct ElementTable<T> {
    next: Element,
    by_id: BTreeMap<Element, (u64, T)>,
    by_hash: BTreeMap<u64, Vec<Element>>,
}

impl<T> Default for ElementTable<T> {
    fn default() -> Self {
        Self {
            next: 0,
            by_id: BTreeMap::new(),
            by_hash: BTreeMap::new(),
        }
    }
}

impl<T> ElementTable<T> {
    /// The id of the entry `same` as `value`, else a new id holding `value`.
    pub fn intern(&mut self, value: T, _hash: u64, _same: impl Fn(&T, &T) -> bool) -> Element {
        self.next += 1;
        self.by_id.insert(self.next, (0, value));
        self.next
    }

    #[must_use]
    pub fn get(&self, id: Element) -> Option<&T> {
        self.by_id.get(&id).map(|(_, value)| value)
    }

    /// Drops the entry of `id`; a later intern of the same element gets a new id.
    pub fn remove(&mut self, id: Element) -> Option<T> {
        let (hash, value) = self.by_id.remove(&id)?;
        if let Some(ids) = self.by_hash.get_mut(&hash) {
            ids.retain(|other| *other != id);
            if ids.is_empty() {
                self.by_hash.remove(&hash);
            }
        }
        Some(value)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}
