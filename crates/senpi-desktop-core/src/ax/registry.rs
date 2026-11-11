use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::rc::Rc;

use super::AxHandle;
use crate::error::{CoreResult, DesktopError};
use crate::report::ReportMode;

/// Retained platform objects one session thread keeps at most.
const RETAINED_CAP: usize = 65_536;

/// Hard ceiling on live refs across all targets: each holds one retained object.
const MAX_ENTRIES: usize = RETAINED_CAP;

/// Top-level snapshot generations each target keeps alive.
const LIVE_TOP_GENERATIONS: usize = 8;

thread_local! {
    /// Every retained object alive on this (session) thread, by token.
    static RETAINED: RefCell<RetainedTable> = RefCell::new(RetainedTable::default());
}

/// Where a retained object stands with the refs that could hold it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Hold {
    /// Read by a walk, held by no ref yet.
    Unsaved,
    /// A live ref holds it, so the cap prunes it last.
    Saved,
    /// Every generation that held it expired; a restored reply revives it.
    Expired,
    /// The cap dropped it; it never resolves again.
    Pruned,
}

/// The registry's view of one retained platform object.
struct Binding {
    /// Never reused: a pruned token resolves to nothing, never another element.
    token: u64,
    /// The newest generation whose ref holds the object; 0 until a ref does.
    generation: Cell<u64>,
    hold: Cell<Hold>,
}

impl Binding {
    fn retire(&self) {
        if self.live() {
            self.hold.set(Hold::Expired);
            RETAINED.with(|table| table.borrow_mut().release(self.token));
        }
    }

    fn live(&self) -> bool {
        matches!(self.hold.get(), Hold::Unsaved | Hold::Saved)
    }
}

/// A platform element wrapped by [`AxRegistry::retain_native`].
struct Retained {
    binding: Rc<Binding>,
    element: Box<dyn Any>,
}

impl Drop for Retained {
    fn drop(&mut self) {
        let token = self.binding.token;
        let _ = RETAINED.try_with(|table| {
            if let Ok(mut table) = table.try_borrow_mut() {
                table.release(token);
            }
        });
    }
}

/// Live retained objects in least-recently-used order.
#[derive(Default)]
struct RetainedTable {
    next_token: u64,
    tick: u64,
    live: HashMap<u64, (u64, Rc<Binding>)>,
    by_use: BTreeMap<u64, u64>,
}

impl RetainedTable {
    fn insert(&mut self) -> Rc<Binding> {
        self.next_token = self.next_token.saturating_add(1);
        let binding = Rc::new(Binding {
            token: self.next_token,
            generation: Cell::new(0),
            hold: Cell::new(Hold::Unsaved),
        });
        self.stamp(Rc::clone(&binding));
        while self.live.len() > RETAINED_CAP {
            self.prune_one();
        }
        binding
    }

    /// Marks `binding` most recently used, re-admitting a revived one.
    fn stamp(&mut self, binding: Rc<Binding>) {
        self.tick = self.tick.saturating_add(1);
        let token = binding.token;
        if let Some((tick, _)) = self.live.insert(token, (self.tick, binding)) {
            self.by_use.remove(&tick);
        }
        self.by_use.insert(self.tick, token);
    }

    fn touch(&mut self, token: u64) {
        if let Some(binding) = self.live.get(&token).map(|(_, binding)| Rc::clone(binding)) {
            self.stamp(binding);
        }
    }

    fn release(&mut self, token: u64) {
        if let Some((tick, _)) = self.live.remove(&token) {
            self.by_use.remove(&tick);
        }
    }

    /// Retires the least recently used object no ref holds, else the least
    /// recently used one.
    fn prune_one(&mut self) {
        let unsaved = self
            .by_use
            .values()
            .find(|token| self.live.get(token).is_some_and(|(_, binding)| binding.hold.get() == Hold::Unsaved));
        let Some(token) = unsaved.or_else(|| self.by_use.values().next()).copied() else {
            return;
        };
        if let Some((tick, binding)) = self.live.remove(&token) {
            self.by_use.remove(&tick);
            binding.hold.set(Hold::Pruned);
        }
    }
}

fn binding_of(handle: &AxHandle) -> Option<&Rc<Binding>> {
    handle.downcast_native::<Retained>().map(|retained| &retained.binding)
}

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

/// Maps `eN` refs to handles. Each target keeps its eight newest top-level
/// snapshot generations alive, with every drill-down sub-generation under
/// them; anything older resolves to `StaleRef`. A handle made by
/// [`AxRegistry::retain_native`] is bound to the refs that hold it: once the
/// last of them expires it never resolves again, even through a clone.
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
        let kept: HashSet<*const Binding> = delivered
            .entries
            .values()
            .filter_map(|entry| binding_of(&entry.handle))
            .map(Rc::as_ptr)
            .collect();
        for entry in self.entries.values() {
            if let Some(binding) = binding_of(&entry.handle).filter(|binding| !kept.contains(&Rc::as_ptr(binding))) {
                binding.retire();
            }
        }
        for entry in delivered.entries.values() {
            if let Some(binding) = binding_of(&entry.handle) {
                hold(binding, entry.generation);
            }
        }
        *self = delivered;
    }

    /// Wraps a platform element as a retained object of this thread, bound
    /// to the generation of each ref that holds it; read it back with
    /// [`AxRegistry::retained`]. Past 65,536 live objects the least recently
    /// used one no ref holds is pruned, and its token is never reused.
    pub fn retain_native<T: Any>(element: T) -> AxHandle {
        let binding = RETAINED.with(|table| table.borrow_mut().insert());
        AxHandle::native(Retained {
            binding,
            element: Box::new(element),
        })
    }

    /// The `T` a [`AxRegistry::retain_native`] handle wraps, with the newest
    /// generation whose ref holds it (`None` while no ref does); `None` for
    /// any other handle. `StaleRef` once it was pruned or every generation
    /// that held it expired.
    pub fn retained<T: Any>(handle: &AxHandle) -> Option<CoreResult<(&T, Option<u64>)>> {
        let retained = handle.downcast_native::<Retained>()?;
        let element = retained.element.downcast_ref::<T>()?;
        let binding = &retained.binding;
        if !binding.live() {
            return Some(Err(DesktopError::stale_ref(
                "the element's ref generation expired; re-run ax()/find()",
            )));
        }
        RETAINED.with(|table| table.borrow_mut().touch(binding.token));
        let generation = (binding.hold.get() == Hold::Saved).then(|| binding.generation.get());
        Some(Ok((element, generation)))
    }

    /// Starts a new top-level generation for `target`, dropping the refs of
    /// top-level generations (and their sub-generations) eight snapshots old.
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
        self.evict(|entry| entry.target_key == target && !tops.contains(&entry.top));
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
        if let Some(binding) = binding_of(&handle) {
            hold(binding, generation);
        }
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
            self.evict(|entry| entry.target_key == target && entry.generation == oldest);
        }
    }

    /// Drops the refs `expired` matches and retires each retained object no
    /// remaining ref holds.
    fn evict(&mut self, expired: impl Fn(&Registered) -> bool) {
        let mut released = Vec::new();
        self.entries.retain(|_, entry| {
            let keep = !expired(entry);
            if !keep {
                released.extend(binding_of(&entry.handle).cloned());
            }
            keep
        });
        if released.is_empty() {
            return;
        }
        let held: HashSet<*const Binding> = self
            .entries
            .values()
            .filter_map(|entry| binding_of(&entry.handle))
            .map(Rc::as_ptr)
            .collect();
        for binding in released {
            if !held.contains(&Rc::as_ptr(&binding)) {
                binding.retire();
            }
        }
    }
}

/// A ref of `generation` holds `binding`'s object.
fn hold(binding: &Rc<Binding>, generation: u64) {
    let was = binding.hold.get();
    if was == Hold::Pruned {
        return;
    }
    binding.generation.set(generation);
    binding.hold.set(Hold::Saved);
    if was == Hold::Expired {
        RETAINED.with(|table| table.borrow_mut().stamp(Rc::clone(binding)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn stale(result: CoreResult<impl Sized>) -> Option<ErrorCode> {
        result.err().map(|error| error.code)
    }

    fn retained_u64(handle: &AxHandle) -> CoreResult<(u64, Option<u64>)> {
        AxRegistry::retained::<u64>(handle)
            .expect("a retained handle")
            .map(|(element, generation)| (*element, generation))
    }

    #[test]
    fn generations_keep_the_eight_newest_snapshots() {
        // Given: one ref per snapshot, nine snapshots (e1 in g-8 .. e9 in g).
        let mut r = AxRegistry::default();
        for g in 1..=9 {
            let generation = r.begin_snapshot("x");
            r.register("x", generation, AxHandle::Id(g));
        }
        // When / Then: g-7 (e2) still resolves, g-8 (e1) is stale.
        assert_eq!(stale(r.resolve("e1")), Some(ErrorCode::StaleRef));
        assert!((2..=9).all(|n| r.resolve(&format!("e{n}")).is_ok()));
    }

    #[test]
    fn generations_are_counted_per_target() {
        // Given: e1 in target x, then nine snapshots of target y.
        let mut r = AxRegistry::default();
        let first = r.begin_snapshot("x");
        r.register("x", first, AxHandle::Id(1));
        for _ in 0..9 {
            r.begin_snapshot("y");
        }
        // Then
        assert!(r.resolve("e1").is_ok());
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
        // When / Then: drills evict nothing; seven newer snapshots keep the lineage.
        assert_eq!((first, drill, nested), (1, 2, 3));
        assert!(["e1", "e2", "e3"].iter().all(|r#ref| r.resolve(r#ref).is_ok()));
        assert_eq!(r.generation_of("e3").ok(), Some(nested));
        for _ in 0..7 {
            r.begin_snapshot("x");
        }
        assert!(["e1", "e2", "e3"].iter().all(|r#ref| r.resolve(r#ref).is_ok()));
        // The eighth ages out the whole lineage of snapshot 1.
        r.begin_snapshot("x");
        assert!(["e1", "e2", "e3"]
            .iter()
            .all(|r#ref| stale(r.resolve(r#ref)) == Some(ErrorCode::StaleRef)));
    }

    #[test]
    fn hard_cap_evicts_oldest_generation_of_largest_target() {
        let mut r = AxRegistry::default();
        let g = r.current_generation("x");
        for n in 0..=65_536 {
            r.register("x", g, AxHandle::Id(n));
        }
        assert!(r.entries.len() <= 65_536);
        assert!(r.resolve("e1").is_err());
    }

    #[test]
    fn ref_from_generation_n_minus_eight_is_stale_ref() {
        // Given: e1..e5 registered in generation N-8, then eight newer snapshots.
        let mut r = AxRegistry::default();
        let old = r.begin_snapshot("x");
        for n in 1..=5 {
            r.register("x", old, AxHandle::Id(n));
        }
        for _ in 0..8 {
            r.begin_snapshot("x");
        }
        // When
        let error = stale(r.resolve("e5"));
        // Then
        assert_eq!(error, Some(ErrorCode::StaleRef));
    }

    #[test]
    fn the_retained_cap_prunes_the_oldest_unsaved_object_and_never_reuses_its_token() {
        // Given: object 0 held by a ref, then 65,536 more objects no ref holds.
        let mut r = AxRegistry::default();
        let generation = r.begin_snapshot("x");
        let saved = AxRegistry::retain_native(0_u64);
        r.register("x", generation, saved.clone());
        let mut unsaved: Vec<AxHandle> = (1..=65_535_u64).map(AxRegistry::retain_native).collect();
        assert!(unsaved.iter().all(|handle| retained_u64(handle).is_ok()));
        // When: the 65,537th insert.
        unsaved.push(AxRegistry::retain_native(65_536_u64));
        // Then: the oldest unsaved object (1) is pruned; the older saved one stays.
        assert_eq!(stale(retained_u64(&unsaved[0])), Some(ErrorCode::StaleRef));
        assert_eq!(retained_u64(&saved).ok(), Some((0, Some(generation))));
        assert!(unsaved[1..].iter().all(|handle| retained_u64(handle).is_ok()));
        // A pruned object stays dead even when a ref registers it again.
        let reference = r.register("x", generation, unsaved[0].clone());
        assert!(r.resolve(&reference).is_ok_and(|handle| stale(retained_u64(&handle)) == Some(ErrorCode::StaleRef)));
        // Tokens only grow, so no live object carries the pruned one's token.
        let tokens: Vec<u64> = unsaved
            .iter()
            .filter_map(|handle| handle.downcast_native::<Retained>())
            .map(|retained| retained.binding.token)
            .collect();
        assert!(tokens.windows(2).all(|pair| pair[0] < pair[1]));
        let pruned = tokens[0];
        RETAINED.with(|table| {
            let table = table.borrow();
            assert_eq!(table.live.len(), 65_536);
            assert!(!table.live.contains_key(&pruned));
        });
        let next = AxRegistry::retain_native(0_u64);
        assert!(next
            .downcast_native::<Retained>()
            .is_some_and(|retained| retained.binding.token > *tokens.last().unwrap_or(&0)));
    }

    #[test]
    fn a_retained_object_never_resolves_after_its_generation_expires_even_through_a_clone() {
        // Given: object 7 held by e1 in snapshot 1, and a clone kept outside the registry.
        let mut r = AxRegistry::default();
        let first = r.begin_snapshot("x");
        let handle = AxRegistry::retain_native(7_u64);
        r.register("x", first, handle.clone());
        let clone = r.resolve("e1").expect("e1 resolves");
        assert_eq!(retained_u64(&clone).ok(), Some((7, Some(first))));
        // When: snapshot 1 ages out.
        for _ in 0..8 {
            r.begin_snapshot("x");
        }
        // Then: neither the clone nor the original resolve, and the table let it go.
        assert_eq!(stale(retained_u64(&clone)), Some(ErrorCode::StaleRef));
        assert_eq!(stale(retained_u64(&handle)), Some(ErrorCode::StaleRef));
        RETAINED.with(|table| assert!(table.borrow().live.is_empty()));
    }

    #[test]
    fn a_restored_reply_revives_its_objects_and_an_abandoned_one_retires_its_own() {
        // Given: object 1 delivered in snapshot 1; a later reply reads object 2
        // and ages snapshot 1 out before it is abandoned.
        let mut r = AxRegistry::default();
        let first = r.begin_snapshot("x");
        let delivered_handle = AxRegistry::retain_native(1_u64);
        r.register("x", first, delivered_handle.clone());
        let delivered = r.clone();
        let mut last = first;
        for _ in 0..8 {
            last = r.begin_snapshot("x");
        }
        let abandoned_handle = AxRegistry::retain_native(2_u64);
        r.register("x", last, abandoned_handle.clone());
        assert!(retained_u64(&delivered_handle).is_err());
        // When
        r.restore(delivered);
        // Then
        assert_eq!(retained_u64(&delivered_handle).ok(), Some((1, Some(first))));
        assert_eq!(stale(retained_u64(&abandoned_handle)), Some(ErrorCode::StaleRef));
        // And an epoch reset (a fresh registry) retires everything.
        r.restore(AxRegistry::default());
        assert_eq!(stale(retained_u64(&delivered_handle)), Some(ErrorCode::StaleRef));
    }

    #[test]
    fn a_retained_object_held_by_two_refs_lives_until_the_last_expires() {
        // Given: the same object registered in snapshot 1 and again in snapshot 2.
        let mut r = AxRegistry::default();
        let first = r.begin_snapshot("x");
        let handle = AxRegistry::retain_native(3_u64);
        r.register("x", first, handle.clone());
        let second = r.begin_snapshot("x");
        r.register("x", second, handle.clone());
        // When: snapshot 1 ages out.
        for _ in 0..7 {
            r.begin_snapshot("x");
        }
        // Then: e2 still holds it.
        assert_eq!(stale(r.resolve("e1")), Some(ErrorCode::StaleRef));
        assert_eq!(retained_u64(&handle).ok(), Some((3, Some(second))));
        r.begin_snapshot("x");
        assert_eq!(stale(retained_u64(&handle)), Some(ErrorCode::StaleRef));
    }

    #[test]
    fn a_plain_handle_is_not_a_retained_object() {
        assert!(AxRegistry::retained::<u64>(&AxHandle::Id(1)).is_none());
        assert!(AxRegistry::retained::<u32>(&AxRegistry::retain_native(1_u64)).is_none());
    }
}
