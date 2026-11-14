//! Minting a generation from a walk: the numbers come from the identity verdict of
//! `matching`, then the generation is stored, aged out and pruned.

use omo_computer_core::ax::{RootRead, Walk, GENERATIONS_PER_WINDOW};

use super::entry::{identities, Generation, RefEntry};
use super::matching::Drilled;
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
    /// Mints the generation `walk` read under `root`'s window. `drilled` names the element a
    /// drill walked from: the new generation is a sub-generation of its full observation and
    /// leaves every other generation valid.
    pub fn mint(&mut self, root: &RootRead, walk: &Walk, drilled: Option<Drilled<'_>>) -> Minted {
        let window_id = root.window.id.clone();
        let mut identity_changed = false;
        if drilled.is_none() {
            let known = self.windows.get(&window_id).and_then(|window| window.key.clone());
            if known.is_some_and(|key| key != root.window) {
                self.expire(&window_id, Expiry::IdentityChanged);
                identity_changed = true;
            }
        }
        let identities = identities(walk, drilled.map(|d| d.identity));
        let reserved = self.reserved(&window_id, drilled.as_ref());
        let numbers = self.number(&window_id, walk, &reserved, drilled.is_some());
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
                parent: drilled.map(|d| d.top),
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
        self.prune(&window_id, drilled.map_or(number, |d| d.top));
        Minted { generation: number, identity_changed }
    }

    /// Keeps the newest eight full observations of the window and their drills.
    fn age_out(&mut self, window_id: &str) {
        let Some(window) = self.windows.get_mut(window_id) else { return };
        let tops: Vec<u64> = window.generations.values().filter(|g| g.parent.is_none()).map(|g| g.number).collect();
        let keep_from = tops.len().saturating_sub(GENERATIONS_PER_WINDOW);
        let mut removed = Vec::new();
        for old in tops.into_iter().take(keep_from) {
            removed.extend(numbers_with_drills(window, old));
            self.retained -= remove_with_drills(window, old);
        }
        self.forget_owners(window_id, &removed);
    }

    /// Drops the owner entries of `removed` (numbers of generations age-out or the LRU prune
    /// just removed) that no kept generation of `window_id` still holds: the owner map shrinks
    /// with the generations, so element churn cannot grow it. A dropped number resolves to
    /// nothing (`StaleRef`), as a pruned one always did. Numbers an expiry wiped keep their
    /// owner, so their tokens still answer the expiry's reason.
    fn forget_owners(&mut self, window_id: &str, removed: &[u64]) {
        let held: std::collections::HashSet<u64> = self
            .windows
            .get(window_id)
            .map(|window| window.generations.values().flat_map(|g| g.entries.iter().map(|entry| entry.n)).collect())
            .unwrap_or_default();
        for n in removed {
            if !held.contains(n) && self.owner.get(n).is_some_and(|owner| owner == window_id) {
                self.owner.remove(n);
            }
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
            let mut removed = Vec::new();
            if let Some(window) = self.windows.get_mut(&id) {
                removed = numbers_with_drills(window, number);
                self.retained -= remove_with_drills(window, number);
            }
            self.forget_owners(&id, &removed);
        }
    }
}

/// The element numbers generation `number` and the drills under it hold.
fn numbers_with_drills(window: &WindowRefs, number: u64) -> Vec<u64> {
    window
        .generations
        .values()
        .filter(|g| g.number == number || g.parent == Some(number))
        .flat_map(|g| g.entries.iter().map(|entry| entry.n))
        .collect()
}

/// Removes generation `number` and the drills under it; returns the objects released.
fn remove_with_drills(window: &mut WindowRefs, number: u64) -> usize {
    let doomed: Vec<u64> = window
        .generations
        .values()
        .filter(|g| g.number == number || g.parent == Some(number))
        .map(|g| g.number)
        .collect();
    let released = doomed
        .iter()
        .filter_map(|n| window.generations.remove(n))
        .map(|g| g.entries.len())
        .sum();
    forget_unheld(window);
    released
}

/// Drops the per-window map entries of numbers no kept generation holds: the maps shrink with
/// the generations they index, so element churn cannot grow them past the retained cap.
fn forget_unheld(window: &mut WindowRefs) {
    let held: std::collections::HashSet<u64> =
        window.generations.values().flat_map(|g| g.entries.iter().map(|entry| entry.n)).collect();
    window.last_entry.retain(|n, _| held.contains(n));
    window.by_object.retain(|_, n| held.contains(n));
    window.by_native_id.retain(|_, numbers| {
        numbers.retain(|n| held.contains(n));
        !numbers.is_empty()
    });
}
