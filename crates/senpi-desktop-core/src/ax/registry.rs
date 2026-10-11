use std::collections::HashMap;

use super::AxHandle;
use crate::error::{CoreResult, DesktopError};

/// Hard ceiling on live refs across all targets.
const MAX_ENTRIES: usize = 5_000;

struct Registered {
    handle: AxHandle,
    target_key: String,
    generation: u64,
}

/// Maps `eN` refs to handles. Each target keeps its current and previous
/// snapshot generation alive; anything older resolves to `StaleRef`.
pub struct AxRegistry {
    next_ref: u64,
    generations: HashMap<String, u64>,
    entries: HashMap<u64, Registered>,
}

impl Default for AxRegistry {
    fn default() -> Self {
        Self {
            next_ref: 1,
            generations: HashMap::new(),
            entries: HashMap::new(),
        }
    }
}

impl AxRegistry {
    /// Starts a new generation for `target`, dropping refs two generations old.
    pub fn begin_snapshot(&mut self, target: &str) -> u64 {
        let generation = self.generations.entry(target.to_string()).or_default();
        *generation = generation.saturating_add(1);
        let current = *generation;
        self.entries
            .retain(|_, entry| entry.target_key != target || entry.generation.saturating_add(1) >= current);
        current
    }

    pub fn current_generation(&mut self, target: &str) -> u64 {
        *self.generations.entry(target.to_string()).or_insert(1)
    }

    pub fn register(&mut self, target: &str, generation: u64, handle: AxHandle) -> String {
        let id = self.next_ref;
        self.next_ref = self.next_ref.saturating_add(1);
        self.entries.insert(
            id,
            Registered {
                handle,
                target_key: target.to_string(),
                generation,
            },
        );
        self.enforce_cap();
        format!("e{id}")
    }

    pub fn resolve(&self, reference: &str) -> CoreResult<AxHandle> {
        self.entry(reference).map(|entry| entry.handle.clone())
    }

    pub fn target(&self, reference: &str) -> CoreResult<String> {
        self.entry(reference).map(|entry| entry.target_key.clone())
    }

    fn entry(&self, reference: &str) -> CoreResult<&Registered> {
        reference
            .strip_prefix('e')
            .and_then(|id| id.parse::<u64>().ok())
            .and_then(|id| self.entries.get(&id))
            .ok_or_else(|| DesktopError::stale_ref(format!("{reference} expired; re-run ax()/find()")))
    }

    fn enforce_cap(&mut self) {
        while self.entries.len() > MAX_ENTRIES {
            let mut target_sizes: HashMap<&str, usize> = HashMap::new();
            for entry in self.entries.values() {
                *target_sizes.entry(&entry.target_key).or_default() += 1;
            }
            let Some(target) = target_sizes
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(target, _)| target.to_string())
            else {
                break;
            };
            let Some(oldest) = self
                .entries
                .values()
                .filter(|entry| entry.target_key == target)
                .map(|entry| entry.generation)
                .min()
            else {
                break;
            };
            self.entries
                .retain(|_, entry| entry.target_key != target || entry.generation != oldest);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn generations_keep_current_and_previous() {
        let mut r = AxRegistry::default();
        for g in 1..=3 {
            let generation = r.begin_snapshot("x");
            r.register("x", generation, AxHandle::Id(g));
        }
        assert!(r.resolve("e1").is_err());
        assert!(r.resolve("e2").is_ok());
        assert!(r.resolve("e3").is_ok());
    }
    #[test]
    fn hard_cap_evicts_oldest_generation_of_largest_target() {
        let mut r = AxRegistry::default();
        let g = r.current_generation("x");
        for n in 0..5_001 {
            r.register("x", g, AxHandle::Id(n));
        }
        assert!(r.entries.len() <= 5_000);
        assert!(r.resolve("e1").is_err());
    }
    #[test]
    fn ref_from_generation_n_minus_two_is_stale_ref() {
        // Given: e1..e5 registered in generation N-2, then two newer snapshots.
        let mut r = AxRegistry::default();
        let old = r.begin_snapshot("x");
        for n in 1..=5 {
            r.register("x", old, AxHandle::Id(n));
        }
        r.begin_snapshot("x");
        r.begin_snapshot("x");
        // When
        let error = r.resolve("e5").err().map(|error| error.code);
        // Then
        assert_eq!(error, Some(ErrorCode::StaleRef));
    }
}
