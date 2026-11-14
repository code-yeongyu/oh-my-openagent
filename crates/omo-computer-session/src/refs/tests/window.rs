//! The one ref rule: eight generations per window, the needs-observe mark, the at-once expiry
//! of a window, and the retained-object cap.

use omo_computer_core::ax::{AxHandle, NodeRead, RootRead, Walk, WalkNode, WindowKey, RETAINED_OBJECTS};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::report::Effect;

use super::super::testkit::{el, Tree};
use super::super::{Drilled, Expiry, RefRegistry};
use super::{n_of, snap};

fn tree() -> Tree {
    Tree::default().window("w", 1, vec![el("window", "W").obj(1).kids(vec![el("button", "Send").obj(2)])])
}

fn token(refs: &RefRegistry, number: u64) -> String {
    format!("s{number}:e{}", n_of(refs, "w", number, "Send"))
}

const fn stale(reason: Reason) -> Refusal {
    Refusal::new(EngineCode::StaleRef, reason.wire())
}

#[test]
fn refs_older_than_8_generations_are_stale() {
    let mut tree = tree();
    let mut refs = RefRegistry::default();
    let tokens: Vec<String> = (0..9)
        .map(|_| {
            let number = snap(&mut tree, &mut refs, "w");
            token(&refs, number)
        })
        .collect();
    assert_eq!(refs.resolve(&tokens[0], true, &mut tree).map_err(|u| u.refusal), Err(Refusal::bare(EngineCode::StaleRef)), "gen-1 after 9 snapshots");
    for live in &tokens[1..] {
        assert!(refs.resolve(live, true, &mut tree).is_ok(), "{live} is one of the last 8");
    }
    // A confirmed or observed report leaves the window valid; the closed set marks it.
    for keeps in [Effect::Confirmed, Effect::Observed] {
        refs.after_report("w", keeps);
        assert_eq!(refs.exec_gate("w"), Ok(()), "{keeps:?}");
    }
    for marks in [Effect::Partial, Effect::Unverifiable, Effect::SuspectedNoop, Effect::Refused] {
        refs.after_report("w", marks);
        assert_eq!(refs.exec_gate("w"), Err(Refusal::new(EngineCode::ControlRequired, Reason::NeedsObserve.wire())), "{marks:?}");
        snap(&mut tree, &mut refs, "w");
        assert_eq!(refs.exec_gate("w"), Ok(()), "a new observation clears {marks:?}");
    }
    refs.after_error("w");
    assert!(refs.exec_gate("w").is_err());
    // An epoch change expires every generation at once.
    let before = token(&refs, refs.latest("w").expect("latest").number);
    refs.expire("w", Expiry::Epoch);
    assert_eq!(refs.exec_gate("w"), Ok(()));
    assert_eq!(refs.resolve(&before, true, &mut tree).map_err(|u| u.refusal), Err(stale(Reason::Epoch)));
    // A relaunched window (new pid) expires its refs at the next observation.
    let current = snap(&mut tree, &mut refs, "w");
    let before = token(&refs, current);
    tree.relaunch("w", 99);
    snap(&mut tree, &mut refs, "w");
    assert_eq!(refs.resolve(&before, true, &mut tree).map_err(|u| u.refusal), Err(stale(Reason::IdentityChanged)));
    // Never minted, unparseable and unqualified tokens.
    for (token, refusal) in [
        ("s1:e999999", Refusal::bare(EngineCode::StaleRef)),
        ("button", Refusal::bare(EngineCode::InvalidTarget)),
        ("e1", Refusal::new(EngineCode::InvalidTarget, Reason::RefUnqualified.wire())),
    ] {
        assert_eq!(refs.resolve(token, true, &mut tree).map_err(|u| u.refusal), Err(refusal), "{token}");
    }
}

fn flat_walk(count: usize, first: u64) -> Walk {
    let node = |i: usize| WalkNode {
        read: NodeRead { handle: Some(AxHandle(first + u64::try_from(i).unwrap_or(0))), role: "cell".into(), ..NodeRead::default() },
        parent: (i > 0).then_some(0),
        depth: u32::from(i > 0),
        logical: u32::from(i > 0),
        children_read: 0,
        hung: false,
    };
    let mut nodes: Vec<WalkNode> = (0..count).map(node).collect();
    nodes[0].read.child_count = u32::try_from(count - 1).unwrap_or(0);
    nodes[0].children_read = nodes[0].read.child_count;
    Walk { nodes, complete: true, elapsed_ms: 0 }
}

fn root(window: &str) -> RootRead {
    RootRead { window: WindowKey { id: window.into(), pid: 1, process_start: 1 }, app: "A".into(), focused: false, node: NodeRead::default() }
}

#[test]
fn the_65537th_object_prunes_the_oldest_generation_and_its_token_resolves_to_nothing() {
    let mut refs = RefRegistry::default();
    let per = RETAINED_OBJECTS / 8;
    let mut first_tokens = Vec::new();
    for window in 0..8 {
        let id = format!("w{window}");
        let minted = refs.mint(&root(&id), &flat_walk(per, 1_000_000 * (window + 1)), None);
        let generation = refs.generation(&id, minted.generation).expect("minted");
        first_tokens.push(generation.token(1));
    }
    assert_eq!(refs.retained(), RETAINED_OBJECTS);
    refs.mint(&root("late"), &flat_walk(1, 99_000_000), None);
    assert_eq!(refs.retained(), RETAINED_OBJECTS + 1 - per, "the least recently used generation went");
    let mut tree = Tree::default();
    assert_eq!(refs.resolve(&first_tokens[0], true, &mut tree).map_err(|u| u.refusal), Err(Refusal::bare(EngineCode::StaleRef)));
    assert!(refs.locate(&first_tokens[1], true).is_ok(), "the next oldest stays");
}

/// Review L1 (#13368): the per-window maps hold only the numbers the kept generations hold, so
/// element churn in a long session cannot grow them past the retained generations.
#[test]
fn element_churn_keeps_the_per_window_maps_to_the_kept_generations() {
    let mut refs = RefRegistry::default();
    for read in 0..40_u64 {
        // Every read shows 50 elements never seen before.
        refs.mint(&root("w"), &flat_walk(50, 1_000 * (read + 1)), None);
    }
    let window = refs.windows.get("w").expect("the window");
    let held: std::collections::HashSet<u64> =
        window.generations.values().flat_map(|g| g.entries.iter().map(|e| e.n)).collect();
    assert_eq!(window.generations.len(), 8, "eight generations kept");
    assert!(window.last_entry.keys().all(|n| held.contains(n)), "last_entry holds only kept numbers");
    assert_eq!(window.last_entry.len(), held.len());
    assert!(window.by_object.values().all(|n| held.contains(n)));
    assert!(window.by_native_id.values().flatten().all(|n| held.contains(n)));
}

/// Review L3 (#13368): a hit on a drill sub-generation refreshes the full observation it hangs
/// under, so heavy drill use keeps that observation (and the drill) through a prune.
#[test]
fn heavy_drill_use_keeps_its_parent_observation_through_a_prune() {
    let mut refs = RefRegistry::with_cap(10);
    let top = refs.mint(&root("a"), &flat_walk(4, 1_000), None).generation;
    let anchor = refs.generation("a", top).expect("a").entries[1].identity.clone();
    let drilled = Drilled { top, from: top, index: 1, identity: &anchor };
    let sub = refs.mint(&root("a"), &flat_walk(2, 2_000), Some(drilled)).generation;
    let drill_token = refs.generation("a", sub).expect("the drill").token(1);
    let other = refs.mint(&root("b"), &flat_walk(4, 3_000), None).generation;
    // The drill is the most recently used generation of all.
    for _ in 0..3 {
        refs.locate(&drill_token, true).expect("the drill resolves");
    }
    refs.mint(&root("c"), &flat_walk(3, 4_000), None);
    assert!(refs.locate(&drill_token, true).is_ok(), "the drill and its parent stay");
    assert!(refs.generation("a", top).is_some(), "the parent stays");
    assert!(refs.generation("b", other).is_none(), "the least recently used observation went");
}
