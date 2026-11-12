//! Which element number a newly read element carries. `n` in `s<generation>:e<n>` is the
//! session-wide element counter, never reused (d-a11y-model.md 'Token shape', line 88; 'Store
//! bounds', line 122): a number is never allocated to a newcomer. An element keeps an old
//! number only when identity re-resolution matches it to the old entry (Amendment A1):
//! (1) the backend reports the same native object, and that object is the latest holder of
//! the number; else (2) its role + native id tuple matches an old entry UNIQUELY (one free old
//! number for that tuple, one unmatched element carrying it) and that old entry is not live
//! under another native object in this read or, for a drill, in the parent generation. A drill
//! reads a sub-generation whose parent stays valid (line 58), so every number live in the
//! parent outside the drilled subtree is reserved (ruling R18). Anything else is not a match:
//! the element gets the next counter number.

use std::collections::{BTreeMap, HashSet};

use omo_computer_core::ax::{NativeObject, NodeRead, Walk};

use super::entry::Identity;
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

/// What a drill's parent generation keeps for itself.
#[derive(Debug, Default)]
pub(crate) struct Reserved {
    /// Numbers of parent elements outside the drilled subtree.
    numbers: HashSet<u64>,
    /// Native objects of the parent generation.
    objects: HashSet<NativeObject>,
}

impl RefRegistry {
    pub(crate) fn reserved(&self, window: &str, drilled: Option<&Drilled<'_>>) -> Reserved {
        let Some((drilled, parent)) = drilled.and_then(|d| Some((d, self.generation(window, d.from)?))) else {
            return Reserved::default();
        };
        let inside = |mut at: usize| loop {
            if at == drilled.index {
                return true;
            }
            match parent.entries[at].parent {
                Some(up) => at = up,
                None => return false,
            }
        };
        Reserved {
            numbers: (0..parent.entries.len()).filter(|i| !inside(*i)).map(|i| parent.entries[i].n).collect(),
            objects: parent.entries.iter().filter_map(|entry| entry.object).collect(),
        }
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
