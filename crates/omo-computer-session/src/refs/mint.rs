//! Minting a generation from a walk. Amendment A1: an element keeps its number across
//! observations when (1) the backend reports the same native object, else (2) role and native
//! id match and the number is unused in this capture; otherwise it gets the next number of the
//! session-wide counter, which is never reused.

use std::collections::{HashMap, HashSet};

use omo_computer_core::ax::{RootRead, Walk, GENERATIONS_PER_WINDOW};

use super::entry::{identities, Generation, Identity, RefEntry};
use super::{RefRegistry, WindowRefs};
use crate::refs::invalidate::Expiry;

/// What a mint reports beside the new generation's number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Minted {
    pub generation: u64,
    /// The window's identity differed from the one its earlier generations bound to: they
    /// all expired before this mint.
    pub identity_changed: bool,
}

impl RefRegistry {
    /// Mints the generation `walk` read under `root`'s window. `drilled` names the generation
    /// and identity of the element a drill walked from: the new generation is its
    /// sub-generation and leaves every other generation valid.
    pub fn mint(&mut self, root: &RootRead, walk: &Walk, drilled: Option<(u64, &Identity)>) -> Minted {
        let window_id = root.window.id.clone();
        let mut identity_changed = false;
        if drilled.is_none() {
            let known = self.windows.get(&window_id).and_then(|window| window.key.clone());
            if known.is_some_and(|key| key != root.window) {
                self.expire(&window_id, Expiry::IdentityChanged);
                identity_changed = true;
            }
        }
        let identities = identities(walk, drilled.map(|(_, identity)| identity));
        let numbers = self.number(&window_id, walk);
        let window = self.windows.entry(window_id.clone()).or_default();
        window.key = Some(root.window.clone());
        window.next_generation += 1;
        let number = window.next_generation;
        let entries: Vec<RefEntry> = walk
            .nodes
            .iter()
            .zip(identities)
            .zip(&numbers)
            .map(|((node, identity), n)| RefEntry {
                n: *n,
                handle: node.read.handle,
                object: node.read.object,
                identity,
                read: node.read.clone(),
                parent: node.parent,
                depth: node.depth,
                logical: node.logical,
                left_out: node.is_cut().then(|| node.read.child_count - node.children_read),
            })
            .collect();
        for node_n in &numbers {
            self.owner.insert(*node_n, window_id.clone());
        }
        self.tick += 1;
        let index = entries.iter().enumerate().map(|(i, entry)| (entry.n, i)).collect();
        self.retained += entries.len();
        let window = self.windows.entry(window_id.clone()).or_default();
        window.generations.insert(
            number,
            Generation {
                number,
                parent: drilled.map(|(parent, _)| parent),
                window: root.window.clone(),
                app: root.app.clone(),
                window_focused: root.focused,
                complete: walk.complete,
                menu_root: walk.nodes.first().is_some_and(|node| node.read.role == "menu"),
                entries,
                index,
                last_used: self.tick,
                outline: None,
                projection: false,
            },
        );
        if drilled.is_none() {
            window.needs_observe = false;
            self.age_out(&window_id);
        }
        self.prune(&window_id, drilled.map_or(number, |(parent, _)| parent));
        Minted { generation: number, identity_changed }
    }

    /// The element number of every node of `walk`. Pass 1 settles every same-native-object
    /// match across the whole read; pass 2 gives a role + native id match only a number pass 1
    /// left unclaimed (with duplicate ids, the old numbers of that key in their old order);
    /// every other node then gets the next number of the counter.
    fn number(&mut self, window_id: &str, walk: &Walk) -> Vec<u64> {
        let window = self.windows.entry(window_id.to_owned()).or_default();
        let key = |read: &omo_computer_core::ax::NodeRead| read.native_id.clone().map(|id| (read.role.clone(), id));
        let mut claimed: HashSet<u64> = HashSet::new();
        let mut numbers: Vec<Option<u64>> = walk
            .nodes
            .iter()
            .map(|node| {
                let n = node.read.object.and_then(|object| window.by_object.get(&object).copied())?;
                claimed.insert(n).then_some(n)
            })
            .collect();
        for (slot, node) in numbers.iter_mut().zip(&walk.nodes) {
            if slot.is_some() {
                continue;
            }
            let candidates = key(&node.read).and_then(|key| window.by_native_id.get(&key));
            if let Some(n) = candidates.and_then(|old| old.iter().copied().find(|n| !claimed.contains(n))) {
                claimed.insert(n);
                *slot = Some(n);
            }
        }
        let numbers: Vec<u64> = numbers
            .into_iter()
            .map(|slot| {
                slot.unwrap_or_else(|| {
                    let n = self.next_n;
                    self.next_n += 1;
                    n
                })
            })
            .collect();
        let mut by_key: HashMap<(String, String), Vec<u64>> = HashMap::new();
        for (node, n) in walk.nodes.iter().zip(&numbers) {
            if let Some(object) = node.read.object {
                window.by_object.insert(object, *n);
            }
            if let Some(key) = key(&node.read) {
                by_key.entry(key).or_default().push(*n);
            }
        }
        window.by_native_id.extend(by_key);
        numbers
    }

    /// Keeps the newest eight full observations of the window and their drills.
    fn age_out(&mut self, window_id: &str) {
        let Some(window) = self.windows.get_mut(window_id) else { return };
        let tops: Vec<u64> = window.generations.values().filter(|g| g.parent.is_none()).map(|g| g.number).collect();
        let keep_from = tops.len().saturating_sub(GENERATIONS_PER_WINDOW);
        for old in tops.into_iter().take(keep_from) {
            self.retained -= remove_with_drills(window, old);
        }
    }

    /// Drops least-recently-used full observations and their drills (never `fresh`, the one
    /// just minted or the parent of the drill just minted) until the store fits its cap.
    fn prune(&mut self, fresh_window: &str, fresh: u64) {
        while self.retained > self.cap {
            let oldest = self
                .windows
                .iter()
                .flat_map(|(id, window)| window.generations.values().map(move |g| (g.last_used, id.clone(), g.number, g.parent)))
                .filter(|(_, id, number, parent)| {
                    parent.is_none() && !(id == fresh_window && (*number == fresh))
                })
                .min();
            let Some((_, id, number, _)) = oldest else { break };
            if let Some(window) = self.windows.get_mut(&id) {
                self.retained -= remove_with_drills(window, number);
            }
        }
    }
}

/// Removes generation `number` and the drills under it; returns the objects released.
fn remove_with_drills(window: &mut WindowRefs, number: u64) -> usize {
    let doomed: Vec<u64> = window
        .generations
        .values()
        .filter(|g| g.number == number || g.parent == Some(number))
        .map(|g| g.number)
        .collect();
    doomed
        .iter()
        .filter_map(|n| window.generations.remove(n))
        .map(|g| g.entries.len())
        .sum()
}
