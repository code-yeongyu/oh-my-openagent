use std::collections::{HashMap, VecDeque};

use super::AxHandle;
use crate::error::{CoreResult, DesktopError};
use crate::report::ReportMode;

/// Hard ceiling on live refs across all targets.
const MAX_ENTRIES: usize = 5_000;

/// Top-level snapshot generations each target keeps alive.
const LIVE_TOP_GENERATIONS: usize = 2;

/// One target's generations. A drill-down allocates a sub-generation that
/// lives as long as the top-level snapshot it descends from.
#[derive(Clone, Default)]
struct Generations {
    latest: u64,
    /// Live top-level generations, oldest first.
    tops: VecDeque<u64>,
    /// Sub-generation -> the top-level generation it descends from.
    lineage: HashMap<u64, u64>,
}

impl Generations {
    fn ensure_started(&mut self) {
        if self.latest == 0 {
            self.latest = 1;
            self.tops.push_back(1);
        }
    }

    fn top_of(&self, generation: u64) -> u64 {
        self.lineage.get(&generation).copied().unwrap_or(generation)
    }
}

#[derive(Clone)]
struct Registered {
    handle: AxHandle,
    target_key: String,
    generation: u64,
    /// The top-level generation `generation` descends from.
    top: u64,
    /// The snapshot that registered it left out some of its children.
    subtree_truncated: bool,
}

/// Maps `eN` refs to handles. Each target keeps its current and previous
/// top-level snapshot generation alive, with every drill-down sub-generation
/// under them; anything older resolves to `StaleRef`.
#[derive(Clone)]
pub struct AxRegistry {
    next_ref: u64,
    generations: HashMap<String, Generations>,
    entries: HashMap<u64, Registered>,
    /// The session's `reportMode`: core and session code read it here so
    /// object-mode-only members are filled in one place.
    report_mode: ReportMode,
}

impl Default for AxRegistry {
    fn default() -> Self {
        Self {
            next_ref: 1,
            generations: HashMap::new(),
            entries: HashMap::new(),
            report_mode: ReportMode::Null,
        }
    }
}

impl AxRegistry {
    /// An empty registry of a session opened with `report_mode`.
    #[must_use]
    pub fn with_report_mode(report_mode: ReportMode) -> Self {
        Self {
            report_mode,
            ..Self::default()
        }
    }

    #[must_use]
    pub const fn report_mode(&self) -> ReportMode {
        self.report_mode
    }

    /// Restores delivered generations without recycling refs from an abandoned reply.
    pub fn restore(&mut self, mut delivered: Self) {
        delivered.next_ref = delivered.next_ref.max(self.next_ref);
        *self = delivered;
    }

    /// Starts a new top-level generation for `target`, dropping the refs of
    /// top-level generations (and their sub-generations) two snapshots old.
    pub fn begin_snapshot(&mut self, target: &str) -> u64 {
        let generations = self.generations.entry(target.to_string()).or_default();
        generations.latest = generations.latest.saturating_add(1);
        let current = generations.latest;
        generations.tops.push_back(current);
        while generations.tops.len() > LIVE_TOP_GENERATIONS {
            generations.tops.pop_front();
        }
        let tops = generations.tops.clone();
        generations.lineage.retain(|_, top| tops.contains(top));
        self.entries
            .retain(|_, entry| entry.target_key != target || tops.contains(&entry.top));
        current
    }

    /// Starts a drill-down sub-generation of `parent` for `target`; every
    /// live ref stays valid.
    pub fn begin_sub_generation(&mut self, target: &str, parent: u64) -> u64 {
        let generations = self.generations.entry(target.to_string()).or_default();
        generations.ensure_started();
        let top = generations.top_of(parent);
        generations.latest = generations.latest.saturating_add(1);
        let current = generations.latest;
        generations.lineage.insert(current, top);
        current
    }

    pub fn current_generation(&mut self, target: &str) -> u64 {
        let generations = self.generations.entry(target.to_string()).or_default();
        generations.ensure_started();
        generations.latest
    }

    /// The generation that registered `reference`.
    pub fn generation_of(&self, reference: &str) -> CoreResult<u64> {
        self.entry(reference).map(|entry| entry.generation)
    }

    pub fn register(&mut self, target: &str, generation: u64, handle: AxHandle) -> String {
        let id = self.next_ref;
        self.next_ref = self.next_ref.saturating_add(1);
        let top = self
            .generations
            .get(target)
            .map_or(generation, |generations| generations.top_of(generation));
        self.entries.insert(
            id,
            Registered {
                handle,
                target_key: target.to_string(),
                generation,
                top,
                subtree_truncated: false,
            },
        );
        self.enforce_cap();
        format!("e{id}")
    }

    pub fn resolve(&self, reference: &str) -> CoreResult<AxHandle> {
        self.entry(reference).map(|entry| entry.handle.clone())
    }

    /// Records that the snapshot which registered `reference` cut its children.
    pub fn mark_subtree_truncated(&mut self, reference: &str) {
        let id = reference.strip_prefix('e').and_then(|id| id.parse::<u64>().ok());
        if let Some(entry) = id.and_then(|id| self.entries.get_mut(&id)) {
            entry.subtree_truncated = true;
        }
    }

    /// Whether the snapshot that registered `reference` cut its children.
    pub fn subtree_truncated(&self, reference: &str) -> bool {
        self.entry(reference).is_ok_and(|entry| entry.subtree_truncated)
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
    fn sub_generations_keep_their_parent_alive_and_age_out_with_their_top() {
        // Given: e1 in snapshot 1, e2 in a drill under it, e3 in a drill of the drill.
        let mut r = AxRegistry::default();
        let first = r.begin_snapshot("x");
        r.register("x", first, AxHandle::Id(1));
        let drill = r.begin_sub_generation("x", first);
        r.register("x", drill, AxHandle::Id(2));
        let nested = r.begin_sub_generation("x", drill);
        r.register("x", nested, AxHandle::Id(3));
        // When / Then: drills evict nothing; one newer snapshot keeps the lineage.
        assert_eq!((first, drill, nested), (1, 2, 3));
        assert!(["e1", "e2", "e3"].iter().all(|r#ref| r.resolve(r#ref).is_ok()));
        assert_eq!(r.generation_of("e3").ok(), Some(nested));
        r.begin_snapshot("x");
        assert!(["e1", "e2", "e3"].iter().all(|r#ref| r.resolve(r#ref).is_ok()));
        // A second one ages out the whole lineage of snapshot 1.
        r.begin_snapshot("x");
        assert!(["e1", "e2", "e3"].iter().all(|r#ref| r.resolve(r#ref).is_err()));
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
