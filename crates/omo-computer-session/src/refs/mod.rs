//! The ref registry of one session: element numbers that are never reused, eight generations
//! per window, 65,536 retained objects with a least-recently-used prune, the one ref rule and
//! its three invalidating events, and re-identification by evidence.

mod entry;
mod invalidate;
mod mint;
mod resolve;

#[cfg(test)]
pub(crate) mod testkit;
#[cfg(test)]
mod tests;

pub use entry::{identities, Generation, Identity, RefEntry};
pub use invalidate::Expiry;
pub use resolve::{Resolved, Unresolved};

use std::collections::{BTreeMap, HashMap};

use omo_computer_core::ax::{NativeObject, RefToken, WindowKey, RETAINED_OBJECTS};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The refs of one window.
#[derive(Debug, Default)]
pub(crate) struct WindowRefs {
    pub(crate) key: Option<WindowKey>,
    pub(crate) next_generation: u64,
    pub(crate) generations: BTreeMap<u64, Generation>,
    pub(crate) by_object: HashMap<NativeObject, u64>,
    /// Role + native id -> the numbers that key carried in its latest read, in document order.
    pub(crate) by_native_id: HashMap<(String, String), Vec<u64>>,
    pub(crate) needs_observe: bool,
    /// Generations below the first number expired at once for the reason.
    pub(crate) wiped: Option<(u64, Reason)>,
}

impl WindowRefs {
    /// The newest generation that is not a drill.
    pub(crate) fn latest_top(&self) -> Option<&Generation> {
        self.generations.values().rev().find(|generation| generation.parent.is_none())
    }
}

#[derive(Debug)]
pub struct RefRegistry {
    pub(crate) next_n: u64,
    pub(crate) windows: HashMap<String, WindowRefs>,
    /// Element number -> the window that minted it; kept after a prune so a pruned token
    /// resolves to nothing rather than to another element.
    pub(crate) owner: HashMap<u64, String>,
    pub(crate) retained: usize,
    pub(crate) cap: usize,
    pub(crate) tick: u64,
}

impl Default for RefRegistry {
    fn default() -> Self {
        Self::with_cap(RETAINED_OBJECTS)
    }
}

/// Where a token points: window, generation number, entry index.
pub type Location = (String, u64, usize);

impl RefRegistry {
    #[must_use]
    pub fn with_cap(cap: usize) -> Self {
        Self { next_n: 1, windows: HashMap::new(), owner: HashMap::new(), retained: 0, cap, tick: 0 }
    }

    /// Objects held by the live generations of every window.
    #[must_use]
    pub const fn retained(&self) -> usize {
        self.retained
    }

    #[must_use]
    pub fn generation(&self, window: &str, number: u64) -> Option<&Generation> {
        self.windows.get(window)?.generations.get(&number)
    }

    /// Records what generation `number` rendered: the baseline a later `since` diffs against.
    pub fn attach(&mut self, window: &str, number: u64, outline: crate::diff::Outline, projection: bool) {
        if let Some(generation) = self.windows.get_mut(window).and_then(|refs| refs.generations.get_mut(&number)) {
            generation.outline = Some(outline);
            generation.projection = projection;
        }
    }

    /// The window's newest full observation.
    #[must_use]
    pub fn latest(&self, window: &str) -> Option<&Generation> {
        self.windows.get(window)?.latest_top()
    }

    /// The generation and entry `token` names, before any re-identification. On an
    /// object-mode session a bare `e<n>` is refused; on a null-mode session it names the
    /// newest generation that holds `n`.
    ///
    /// # Errors
    /// `InvalidTarget` (unparseable), `InvalidTarget{ref_unqualified}`, `StaleRef` (aged out,
    /// pruned or never minted), `StaleRef{epoch|identity_changed}`.
    pub fn locate(&mut self, token: &str, object_mode: bool) -> Result<Location, Refusal> {
        let stale = Refusal::bare(EngineCode::StaleRef);
        let parsed = RefToken::parse(token).ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
        if object_mode && matches!(parsed, RefToken::Bare { .. }) {
            return Err(Refusal::new(EngineCode::InvalidTarget, Reason::RefUnqualified.wire()));
        }
        let window_id = self.owner.get(&parsed.n()).ok_or_else(|| stale.clone())?.clone();
        let window = self.windows.get_mut(&window_id).ok_or_else(|| stale.clone())?;
        let number = match parsed {
            RefToken::Bare { n } => window
                .generations
                .values()
                .rev()
                .find(|generation| generation.position(n).is_some())
                .map(|generation| generation.number)
                .ok_or_else(|| stale.clone())?,
            RefToken::Qualified { generation, .. } => generation,
        };
        let Some(generation) = window.generations.get_mut(&number) else {
            return Err(match window.wiped {
                Some((below, reason)) if number < below => Refusal::new(EngineCode::StaleRef, reason.wire()),
                _ => stale,
            });
        };
        let index = generation.position(parsed.n()).ok_or(stale)?;
        self.tick += 1;
        generation.last_used = self.tick;
        Ok((window_id, number, index))
    }
}
