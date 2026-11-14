//! The re-identification ladder: verdicts by evidence on every rung, never a first match.

use omo_computer_core::ax::{AxHandle, AxReader};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::super::testkit::{el, Node, Tree};
use super::super::{RefRegistry, Unresolved};
use super::{n_of, snap};

fn window(children: Vec<Node>) -> Node {
    el("window", "W").obj(1).kids(vec![el("toolbar", "Tools").obj(2).kids(children)])
}

/// Observes version 0, switches to version 1 (observing it again when `newer`), and resolves
/// the version-0 ref of `title`.
fn after_change(v0: Vec<Node>, v1: Vec<Node>, newer: bool, title: &str) -> (Result<String, Unresolved>, Tree) {
    let mut tree = Tree::default().window("w", 1, vec![window(v0), window(v1)]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    let token = format!("s{g1}:e{}", n_of(&refs, "w", g1, title));
    tree.show("w", 1);
    if newer {
        snap(&mut tree, &mut refs, "w");
    }
    let result = refs.resolve(&token, true, &mut tree).map(|resolved| {
        let generation = refs.generation(&resolved.window, resolved.generation).expect("generation");
        let value = resolved.live.value.unwrap_or_default();
        format!("{}:{value}@{}", resolved.live.title.unwrap_or_default(), generation.token(resolved.index))
    });
    (result, tree)
}

const fn refusal(code: EngineCode, reason: Reason) -> Refusal {
    Refusal::new(code, reason.wire())
}

#[test]
fn reidentify_zero_is_stale_two_is_ambiguous() {
    let send = || el("button", "Send").at(0.0, 0.0);
    // Rung 2 (a newer observation exists) and rung 3 (a bounded live read) give one verdict.
    for newer in [true, false] {
        let (zero, _) = after_change(vec![send()], vec![el("button", "Cancel")], newer, "Send");
        assert_eq!(zero.map_err(|u| u.refusal), Err(refusal(EngineCode::StaleRef, Reason::SavedRefAbsent)), "newer={newer}");

        let twins = vec![el("button", "Send").at(5.0, 0.0), el("button", "Send").at(9.0, 0.0)];
        let (two, _) = after_change(vec![send()], twins, newer, "Send");
        let ambiguous = two.expect_err("two candidates");
        assert_eq!(ambiguous.refusal, Refusal::bare(EngineCode::AmbiguousTarget), "newer={newer}");
        assert_eq!(ambiguous.candidates.len(), 2, "newer={newer}");
        assert!(ambiguous.candidates.iter().all(|c| c.role == "button" && c.label.as_deref() == Some("Send")));

        let (one, _) = after_change(vec![send()], vec![el("button", "Cancel"), el("button", "Send").at(7.0, 0.0)], newer, "Send");
        assert!(one.expect("one candidate").starts_with("Send:@"), "newer={newer}");

        // The bounds hash breaks a tie only: the twin at the old place is the element.
        let tie = vec![el("button", "Send").at(9.0, 0.0), el("button", "Send").at(0.0, 0.0).value("moved-not")];
        let (tied, _) = after_change(vec![send()], tie, newer, "Send");
        let resolved = tied.expect("tie broken");
        assert!(resolved.starts_with("Send:moved-not@"), "{resolved}");

        // Another place in the tree is another element: the ancestor path is evidence.
        let elsewhere = vec![el("group", "G").kids(vec![el("button", "Send")])];
        let (moved, _) = after_change(vec![send()], elsewhere, newer, "Send");
        assert_eq!(moved.map_err(|u| u.refusal), Err(refusal(EngineCode::StaleRef, Reason::SavedRefAbsent)));
    }
}

#[test]
fn non_unique_at_capture_ref_is_stale_when_handle_dies() {
    let twins = vec![el("button", "OK").obj(10), el("button", "OK").obj(11)];
    let mut tree = Tree::default().window("w", 1, vec![window(twins), window(vec![el("button", "OK").obj(12)])]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    let generation = refs.generation("w", g1).expect("g1");
    let second = generation.entries.iter().position(|e| e.object.is_some_and(|o| o.0 == 11)).expect("twin 11");
    assert!(!generation.entries[second].identity.unique_at_capture);
    let token = generation.token(second);
    let resolved = refs.resolve(&token, true, &mut tree).expect("the live handle answers");
    assert_eq!(resolved.live.handle, Some(AxHandle(11)), "the handle, not the first twin");
    tree.show("w", 1);
    for newer in [false, true] {
        if newer {
            snap(&mut tree, &mut refs, "w");
        }
        let dead = refs.resolve(&token, true, &mut tree).map_err(|u| u.refusal);
        assert_eq!(dead, Err(refusal(EngineCode::StaleRef, Reason::NotUniqueAtCapture)), "one lookalike is still not proof (newer={newer})");
    }
}

#[test]
fn unknown_field_on_sole_candidate_is_resolution_identity_unknown() {
    let unknown = Some(refusal(EngineCode::Timeout, Reason::ResolutionIdentityUnknown));
    for newer in [true, false] {
        let (sole, _) = after_change(vec![el("button", "Send")], vec![el("button", "").unread_title()], newer, "Send");
        assert_eq!(sole.err().map(|u| u.refusal), unknown, "newer={newer}");
    }
    // The fast path: the retained object answers, but its label could not be read.
    let alive = |unread: bool| {
        let button = if unread { el("button", "").obj(5).unread_title() } else { el("button", "Send").obj(5) };
        window(vec![button])
    };
    let mut tree = Tree::default().window("w", 1, vec![alive(false), alive(true)]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    let token = format!("s{g1}:e{}", n_of(&refs, "w", g1, "Send"));
    tree.show("w", 1);
    assert_eq!(refs.resolve(&token, true, &mut tree).err().map(|u| u.refusal), unknown);
    // A control that does not answer its slice is unknown too, and costs one slice.
    tree.show("w", 0);
    tree.hung.insert(5);
    let before = tree.now_ms();
    assert_eq!(refs.resolve(&token, true, &mut tree).err().map(|u| u.refusal), unknown);
    assert_eq!(tree.now_ms() - before, omo_computer_core::ax::SLICE_MS);
}

/// Review L2 (#13368, ruling R70x): live (rung 3) candidates are told apart. Each carries a
/// fresh token in a real sub-generation (never the input token, never generation 0); by
/// amendment A1 each keeps its e number in the next observation; a secure twin shows role +
/// ref only.
#[test]
fn live_twins_get_fresh_distinct_tokens_and_a_secure_twin_shows_role_and_ref_only() {
    let mut secure = el("button", "Send").obj(21).at(9.0, 0.0);
    secure.read.secure = true;
    let twins = vec![el("button", "Send").obj(20).at(5.0, 0.0), secure];
    let mut tree = Tree::default().window("w", 1, vec![window(vec![el("button", "Send").at(0.0, 0.0)]), window(twins)]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    let token = format!("s{g1}:e{}", n_of(&refs, "w", g1, "Send"));
    tree.show("w", 1);
    let ambiguous = refs.resolve(&token, true, &mut tree).expect_err("two live twins");
    assert_eq!(ambiguous.refusal, Refusal::bare(EngineCode::AmbiguousTarget));
    let [plain, hidden] = ambiguous.candidates.as_slice() else { panic!("two candidates: {:?}", ambiguous.candidates) };
    assert_ne!(plain.reference, hidden.reference, "the twins are told apart");
    for candidate in [plain, hidden] {
        assert_ne!(candidate.reference, token, "never the input token");
        assert!(candidate.generation > g1, "a real, newer generation: {}", candidate.generation);
        assert!(refs.locate(&candidate.reference, true).is_ok(), "{} locates", candidate.reference);
    }
    assert_eq!(plain.label.as_deref(), Some("Send"));
    assert_eq!(
        (hidden.role.as_str(), &hidden.label, &hidden.title, &hidden.value, &hidden.bounds, &hidden.actions),
        ("button", &None, &None, &None, &None, &None),
        "a secure candidate carries role + ref only"
    );
    // The next observation keeps each twin's e number (amendment A1), so the number resolves.
    let g3 = snap(&mut tree, &mut refs, "w");
    for candidate in [plain, hidden] {
        let n = candidate.reference.split(':').nth(1).expect("e<n>");
        let again = format!("s{g3}:{n}");
        assert!(refs.locate(&again, true).is_ok(), "{again} after the new observation");
    }
}

/// Review L2 (#13368, ruling R70z, the checker's falsifier): the fresh candidate tokens identify,
/// they do not license an act. After `AmbiguousTarget` the window's exec gate refuses until a
/// new full observation; the sub-generation the failing resolve minted does not count as one.
#[test]
fn an_act_after_ambiguous_target_waits_for_a_new_observe() {
    let twins = vec![el("button", "Send").obj(20).at(5.0, 0.0), el("button", "Send").obj(21).at(9.0, 0.0)];
    let mut tree = Tree::default().window("w", 1, vec![window(vec![el("button", "Send").at(0.0, 0.0)]), window(twins)]);
    let mut refs = RefRegistry::default();
    let g1 = snap(&mut tree, &mut refs, "w");
    let token = format!("s{g1}:e{}", n_of(&refs, "w", g1, "Send"));
    tree.show("w", 1);
    let ambiguous = refs.resolve(&token, true, &mut tree).expect_err("two live twins");
    assert_eq!(ambiguous.refusal, Refusal::bare(EngineCode::AmbiguousTarget));
    assert_eq!(
        refs.exec_gate("w"),
        Err(refusal(EngineCode::ControlRequired, Reason::NeedsObserve)),
        "no act on a candidate's fresh token before a new observe"
    );
    snap(&mut tree, &mut refs, "w");
    assert_eq!(refs.exec_gate("w"), Ok(()), "a new full observation lifts it");
}
