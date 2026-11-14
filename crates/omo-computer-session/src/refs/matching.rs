//! Which element number a newly read element carries. `n` in `s<generation>:e<n>` is the
//! session-wide element counter, never reused (d-a11y-model.md 'Token shape', line 88; 'Store
//! bounds', line 122): a number is never allocated to a newcomer. An element keeps an old
//! number only when identity re-resolution matches it to the old entry (Amendment A1):
//! (1) the backend reports the same native object, and that object is the latest holder of
//! the number; else (2) its role + native id tuple matches an old entry UNIQUELY (one free old
//! number for that tuple, one unmatched element carrying it) and that old entry is not live
//! under another native object in this read or, for a drill, in any valid generation of the
//! window. A drill reads a sub-generation whose parent stays valid (line 58), so every number a
//! valid generation holds outside the drilled subtree is reserved (ruling R18). Anything else is
//! not a match: the element gets the next counter number.
//!
//! A full read cut short (`complete:false`: the 2,000-node budget or the 3,000 ms deadline)
//! treats the elements past the cut as absent - literally "unused in this capture" - so a
//! lookalike read before the cut may inherit the number of an element past it. Diffs already
//! refuse incomplete reads (`baseline_incomplete` / `current_incomplete`).

use std::collections::{BTreeMap, HashSet};

use omo_computer_core::ax::{NativeObject, NodeRead, Walk};

use super::entry::{Generation, Identity};
use super::RefRegistry;

/// Role + native id.
pub(crate) type Tuple = (String, String);

pub(crate) fn tuple(read: &NodeRead) -> Option<Tuple> {
    read.native_id.clone().map(|id| (read.role.clone(), id))
}

/// The element a drill walked from: its generation (`from`), entry index and identity, and
/// the full observation (`top`) the new sub-generation hangs under.
#[derive(Debug, Clone, Copy)]
pub struct Drilled<'a> {
    pub top: u64,
    pub from: u64,
    pub index: usize,
    pub identity: &'a Identity,
}

/// What the valid generations of a window keep from a drill's lookalikes.
#[derive(Debug, Default)]
pub(crate) struct Reserved {
    /// Numbers a valid generation holds outside the drilled element's subtree.
    numbers: HashSet<u64>,
    /// Native objects of the valid generations.
    objects: HashSet<NativeObject>,
}

/// Entry `at` of `generation` is the element numbered `root` or lies under it.
fn under(generation: &Generation, mut at: usize, root: u64) -> bool {
    loop {
        if generation.entries[at].n == root {
            return true;
        }
        match generation.entries[at].parent {
            Some(up) => at = up,
            None => return false,
        }
    }
}

impl RefRegistry {
    /// A drill reads part of the window, so "live" means live in ANY valid generation of the
    /// window - every full read and sub-generation still inside the 8-generation window, the
    /// full read the drill hangs under and newer reads than the one it resolved from included
    /// (line 58, ruling R18). A full read sees the whole window: nothing is reserved, and
    /// liveness is presence in that read.
    pub(crate) fn reserved(&self, window: &str, drilled: Option<&Drilled<'_>>) -> Reserved {
        let Some(refs) = drilled.and(self.windows.get(window)) else {
            return Reserved::default();
        };
        let Some(root) = drilled.and_then(|d| refs.generations.get(&d.from)?.entries.get(d.index)).map(|entry| entry.n) else {
            return Reserved::default();
        };
        let mut reserved = Reserved::default();
        for generation in refs.generations.values() {
            for (at, entry) in generation.entries.iter().enumerate() {
                if !under(generation, at, root) {
                    reserved.numbers.insert(entry.n);
                }
                reserved.objects.extend(entry.object);
            }
        }
        reserved
    }

    /// The number of every node of `walk`, by the verdict above.
    pub(crate) fn number(&mut self, window_id: &str, walk: &Walk, reserved: &Reserved, drill: bool) -> Vec<u64> {
        let window = self.windows.entry(window_id.to_owned()).or_default();
        let present: HashSet<NativeObject> = walk.nodes.iter().filter_map(|node| node.read.object).collect();
        let mut numbers: Vec<Option<u64>> = walk
            .nodes
            .iter()
            .map(|node| {
                let object = node.read.object?;
                let n = *window.by_object.get(&object)?;
                (window.last_entry.get(&n).is_some_and(|(holder, _)| *holder == Some(object))).then_some(n)
            })
            .collect();
        let mut matched: HashSet<u64> = numbers.iter().flatten().copied().collect();
        let mut waiting: BTreeMap<Tuple, Vec<usize>> = BTreeMap::new();
        for (index, node) in walk.nodes.iter().enumerate().filter(|(i, _)| numbers[*i].is_none()) {
            if let Some(tuple) = tuple(&node.read) {
                waiting.entry(tuple).or_default().push(index);
            }
        }
        for (tuple, nodes) in waiting {
            let free: Vec<u64> = window
                .by_native_id
                .get(&tuple)
                .into_iter()
                .flatten()
                .copied()
                .filter(|n| !matched.contains(n) && !reserved.numbers.contains(n))
                .filter(|n| {
                    window.last_entry.get(n).is_some_and(|(holder, last)| {
                        last.as_ref() == Some(&tuple) && holder.is_none_or(|o| !present.contains(&o) && !reserved.objects.contains(&o))
                    })
                })
                .collect();
            if let ([n], [index]) = (free.as_slice(), nodes.as_slice()) {
                numbers[*index] = Some(*n);
                matched.insert(*n);
            }
        }
        let numbers: Vec<u64> = numbers
            .into_iter()
            .map(|kept| {
                kept.unwrap_or_else(|| {
                    let n = self.next_n;
                    self.next_n += 1;
                    n
                })
            })
            .collect();
        let window = self.windows.entry(window_id.to_owned()).or_default();
        let mut by_tuple: BTreeMap<Tuple, Vec<u64>> = BTreeMap::new();
        for (node, n) in walk.nodes.iter().zip(&numbers) {
            if let Some(object) = node.read.object {
                window.by_object.insert(object, *n);
            }
            let tuple = tuple(&node.read);
            window.last_entry.insert(*n, (node.read.object, tuple.clone()));
            if let Some(tuple) = tuple {
                by_tuple.entry(tuple).or_default().push(*n);
            }
        }
        for (tuple, ns) in by_tuple {
            let list = window.by_native_id.entry(tuple).or_default();
            if drill {
                let added: Vec<u64> = ns.into_iter().filter(|n| !list.contains(n)).collect();
                list.extend(added);
            } else {
                *list = ns;
            }
        }
        numbers
    }
}
