//! A seeded property test of A1 numbering. Each seed scripts random reads of a window whose rows
//! sit three levels deep (window / group / subgroup / row): add, remove, move across subgroups,
//! recreate, lookalike, return of a removed row. Between full reads it drills random containers
//! of random VALID generations - older full reads and earlier drills included, so drills of
//! drills nest - and the next full read follows. After every read it checks:
//! (a) an object present in the previous read keeps its number;
//! (b) no number is held by two elements of one read;
//! (c) a number never moves away from an object present in the read;
//! (d) a diff never marks as changed (`~`) a number whose baseline object is still present
//!     under another number (a false relabel);
//! (e) a drill never gives an element a number that any valid generation of the window holds
//!     for another live element: under another native object still present, or (without one)
//!     outside the drilled element's subtree in that generation.
//! The seeds are fixed and the run is bounded.

use std::collections::{BTreeMap, BTreeSet};

use super::super::testkit::{el, Node, Tree};
use super::super::RefRegistry;
use super::ownership::{holders, read};
use crate::observe::drill;

/// A deterministic generator (an LCG with fixed constants).
struct Lcg(u64);

impl Lcg {
    fn below(&mut self, bound: usize) -> usize {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        usize::try_from((self.0 >> 33) % u64::try_from(bound.max(1)).unwrap_or(1)).unwrap_or(0)
    }
}

#[derive(Clone)]
struct Row {
    title: String,
    role: &'static str,
    id: Option<&'static str>,
    object: Option<u64>,
    /// group * 2 + subgroup.
    group: usize,
}

impl Row {
    fn node(&self) -> Node {
        let mut node = el(self.role, &self.title);
        if let Some(id) = self.id {
            node = node.id(id);
        }
        if let Some(object) = self.object {
            node = node.obj(object);
        }
        node
    }
}

fn window(rows: &[Row]) -> Node {
    let sub = |s: usize| {
        let kids = rows.iter().filter(|r| r.group == s).map(Row::node).collect();
        el("group", &format!("S{s}")).obj(5 + u64::try_from(s).unwrap_or(0)).kids(kids)
    };
    let group = |g: usize| el("group", &format!("G{g}")).obj(3 + u64::try_from(g).unwrap_or(0)).kids(vec![sub(2 * g), sub(2 * g + 1)]);
    el("window", "W").obj(1).kids(vec![group(0), group(1)])
}

/// The rows of every read of one seed: each read applies 1-3 random edits to the last.
fn script(rng: &mut Lcg, reads: usize) -> Vec<Vec<Row>> {
    let ids = [None, Some("a"), Some("b")];
    let roles = ["listitem", "listitem", "button"];
    let mut next = 10_u64;
    let mut fresh = |rng: &mut Lcg| {
        next += 1;
        Row { title: format!("r{next}"), role: roles[rng.below(3)], id: ids[rng.below(3)], object: (rng.below(5) != 0).then_some(next), group: rng.below(4) }
    };
    let mut rows: Vec<Row> = (0..rng.below(5) + 1).map(|_| fresh(rng)).collect();
    let mut gone: Vec<Row> = Vec::new();
    let mut out = vec![rows.clone()];
    for _ in 1..reads {
        for _ in 0..rng.below(3) + 1 {
            let at = rng.below(rows.len() + 1);
            match rng.below(6) {
                0 => rows.insert(at, fresh(rng)),
                1 if !rows.is_empty() => gone.push(rows.remove(rng.below(rows.len()))),
                2 if !rows.is_empty() => {
                    let mut row = rows.remove(rng.below(rows.len()));
                    row.group = rng.below(4);
                    rows.insert(rng.below(rows.len() + 1), row);
                }
                3 if !rows.is_empty() => {
                    let i = rng.below(rows.len());
                    rows[i].object = rows[i].object.map(|o| o + 1_000);
                }
                4 if !rows.is_empty() => {
                    let twin = rows[rng.below(rows.len())].clone();
                    let mut look = fresh(rng);
                    (look.role, look.id) = (twin.role, twin.id);
                    rows.insert(at, look);
                }
                5 if !gone.is_empty() => {
                    let back = gone.remove(rng.below(gone.len()));
                    if back.object.is_none() || !rows.iter().any(|r| r.object == back.object) {
                        rows.insert(at.min(rows.len()), back);
                    }
                }
                _ => {}
            }
        }
        out.push(rows.clone());
    }
    out
}

/// Whether entry `at` of `generation` is the element numbered `root` or lies under it.
fn under(generation: &crate::refs::Generation, mut at: usize, root: u64) -> bool {
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

/// (e): drill entries holding a number another valid generation holds for another element.
fn drill_breaches(refs: &RefRegistry, sub: u64) -> Vec<String> {
    let drilled = refs.generation("w", sub).expect("sub-generation");
    let root = drilled.entries[0].n;
    // Live: present in the newest full read or in the drill's own read. A recreated element that
    // inherited a number in a full read (A1 rule 2) left its old object dead, not foreign.
    let live: BTreeSet<u64> = refs.latest("w").into_iter().chain([drilled]).flat_map(|g| g.entries.iter().filter_map(|e| e.object.map(|o| o.0))).collect();
    let others: Vec<&crate::refs::Generation> = refs.windows["w"].generations.values().filter(|g| g.number != sub).collect();
    let mut out = Vec::new();
    for entry in &drilled.entries {
        // Continuity: the same native object already held this number in a valid generation, so
        // the drill decided nothing (a number a full read handed on is checked by (a)-(d)).
        let kept = entry.object.is_some_and(|o| others.iter().any(|g| g.position(entry.n).is_some_and(|at| g.entries[at].object == Some(o))));
        if kept {
            continue;
        }
        let foreign = refs.windows["w"].generations.values().filter(|g| g.number != sub).find_map(|other| {
            let at = other.position(entry.n)?;
            let held = &other.entries[at];
            let foreign = match held.object {
                Some(object) => entry.object != Some(object) && live.contains(&object.0),
                None => !under(other, at, root),
            };
            foreign.then(|| format!("(e) drill s{sub} gave {:?} e{} that s{} holds for {:?}", entry.read.title, entry.n, other.number, held.read.title))
        });
        out.extend(foreign);
    }
    out
}

fn breaches(seed: u64, reads: usize) -> Vec<String> {
    let mut rng = Lcg(seed.wrapping_mul(7_919).wrapping_add(1));
    let script = script(&mut rng, reads);
    let mut tree = Tree::default().window("w", 1, script.iter().map(|rows| window(rows)).collect());
    let mut refs = RefRegistry::default();
    let mut out = Vec::new();
    let mut last_holder: BTreeMap<u64, u64> = BTreeMap::new();
    let mut previous: Option<(u64, BTreeMap<u64, u64>)> = None;
    for index in 0..script.len() {
        tree.show("w", index);
        let observation = read(&mut refs, &mut tree, previous.as_ref().map(|(g, _)| *g));
        let numbers: Vec<u64> = refs.generation("w", observation.generation).expect("read").entries.iter().map(|e| e.n).collect();
        if numbers.len() != numbers.iter().collect::<BTreeSet<_>>().len() {
            out.push(format!("seed {seed} read {index}: (b) a number twice in one read"));
        }
        let now = holders(&refs, observation.generation);
        if let Some((_, before)) = &previous {
            for (object, n) in &now {
                if before.get(object).is_some_and(|old| old != n) {
                    out.push(format!("seed {seed} read {index}: (a) object {object} e{} -> e{n}", before[object]));
                }
            }
            let was: BTreeMap<u64, u64> = before.iter().map(|(o, n)| (*n, *o)).collect();
            for line in observation.diff.as_deref().unwrap_or_default().lines().filter(|l| l.starts_with("~ ")) {
                let n: u64 = line.split(":e").nth(1).and_then(|r| r.split(']').next()).and_then(|d| d.parse().ok()).unwrap_or(0);
                if let Some(old) = was.get(&n).filter(|old| now.get(old).is_some_and(|m| *m != n)) {
                    out.push(format!("seed {seed} read {index}: (d) e{n} relabelled while its object {old} lives as e{}", now[old]));
                }
            }
        }
        for (object, n) in &now {
            if last_holder.get(n).is_some_and(|holder| holder != object && now.contains_key(holder)) {
                out.push(format!("seed {seed} read {index}: (c) e{n} moved from a live object to {object}"));
            }
        }
        last_holder.extend(now.iter().map(|(o, n)| (*n, *o)));
        if index + 1 < script.len() && rng.below(3) != 0 {
            tree.show("w", index + 1);
            for _ in 0..rng.below(3) + 1 {
                let valid: Vec<u64> = refs.windows["w"].generations.keys().copied().collect();
                let from = if rng.below(2) == 0 { valid[valid.len() - 1] } else { valid[rng.below(valid.len())] };
                let generation = refs.generation("w", from).expect("valid");
                let containers: Vec<usize> = (0..generation.entries.len()).filter(|i| generation.entries[*i].read.role == "group").collect();
                if containers.is_empty() {
                    continue;
                }
                let token = generation.token(containers[rng.below(containers.len())]);
                let Ok(drilled) = drill(&mut refs, &mut tree, &token, None, true) else { continue };
                out.extend(drill_breaches(&refs, drilled.generation).into_iter().map(|b| format!("seed {seed} read {index}: {b}")));
                // A drill is a read too: its holders are the latest holders of their numbers.
                last_holder.extend(holders(&refs, drilled.generation).into_iter().map(|(o, n)| (n, o)));
            }
        }
        previous = Some((observation.generation, now));
    }
    out
}

#[test]
fn numbering_fuzz_holds_the_a1_invariants_on_every_read_and_drill() {
    const SEEDS: u64 = 3_000;
    const READS: usize = 8;
    let found: Vec<String> = (0..SEEDS).flat_map(|seed| breaches(seed, READS)).collect();
    let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
    for breach in &found {
        let kind = breach.split(": (").nth(1).and_then(|k| k.split(')').next()).unwrap_or("?");
        *by_kind.entry(kind).or_insert(0) += 1;
    }
    assert!(
        found.is_empty(),
        "{} A1 invariant breaches over {SEEDS} seeds x {READS} reads, by invariant {by_kind:?}; first: {:#?}",
        found.len(),
        &found[..found.len().min(8)]
    );
}
