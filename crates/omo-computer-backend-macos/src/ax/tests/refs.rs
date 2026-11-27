//! Refs bound to retained objects, the remote-token resolve behind its probe, and the
//! identity check that makes an old ref stale after a relaunch.

use omo_computer_core::ax::{walk, AxReader, Limits, Slice};
use omo_computer_core::backend::{Refusal, Semantic};
use omo_computer_core::error::{EngineCode, Reason};

use super::kit::{FakeAx, FakeToken};
use crate::ax::MacAx;

fn two_nodes(token: bool) -> MacAx<FakeAx> {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.tree(100, 2, 1);
    fake.token = token.then(FakeToken::default);
    MacAx::new(fake)
}

fn child_handle(ax: &mut MacAx<FakeAx>) -> omo_computer_core::ax::AxHandle {
    let root = ax.root("7").expect("root");
    let limits = Limits::of(ax);
    walk(ax, root.node, &limits).nodes[1]
        .read
        .handle
        .expect("handle")
}

#[test]
fn remote_token_symbol_missing_uses_retained_object() {
    let mut ax = two_nodes(false);
    let handle = child_handle(&mut ax);
    assert!(
        matches!(ax.node(handle, 250), Slice::Read(Some(read)) if read.title.as_deref() == Some("n101"))
    );
    assert_eq!(
        ax.server().reads.get(&101),
        Some(&2),
        "the retained element read again"
    );

    let mut ax = two_nodes(true);
    let handle = child_handle(&mut ax);
    let before = ax.server().token.as_ref().map(|t| t.calls).unwrap_or(0);
    assert!(matches!(ax.node(handle, 250), Slice::Read(Some(_))));
    let after = ax.server().token.as_ref().map(|t| t.calls).unwrap_or(0);
    assert_eq!(
        after,
        before + 1,
        "resolved through the token when the symbol resolved"
    );
}

#[test]
fn stale_ref_after_relaunch_is_identity_changed() {
    let mut ax = two_nodes(false);
    let handle = child_handle(&mut ax);
    ax.server_mut()
        .windows
        .get_mut(&7)
        .expect("window")
        .0
        .process_start = 2_000;
    assert_eq!(
        ax.perform(handle, &Semantic("press".into())),
        Err(Refusal::new(EngineCode::StaleRef, Reason::IdentityChanged))
    );
    assert!(ax.server().performed.is_empty(), "nothing sent");
}

#[test]
fn gone_element_reads_none() {
    let mut ax = two_nodes(false);
    let handle = child_handle(&mut ax);
    ax.server_mut().gone.push(101);
    assert!(matches!(ax.node(handle, 250), Slice::Read(None)));
}
