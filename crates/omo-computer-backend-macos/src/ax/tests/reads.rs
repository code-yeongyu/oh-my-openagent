//! Batched reads under the deadline and the Chromium wake (design rows M8).

use omo_computer_core::ax::{walk, AxReader, Limits};

use super::kit::{node, FakeAx, OnPoke};
use crate::ax::seam::AxValue;
use crate::ax::MacAx;

fn reader(fake: FakeAx) -> MacAx<FakeAx> {
    MacAx::new(fake)
}

#[test]
fn one_ipc_call_per_node() {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.tree(100, 300, 4);
    let mut ax = reader(fake);
    let root = ax.root("7").expect("root");
    let limits = Limits::of(&ax);
    let walked = walk(&mut ax, root.node, &limits);
    assert!(walked.complete);
    assert_eq!(walked.nodes.len(), 300);
    let reads = &ax.server().reads;
    assert_eq!(reads.len(), 300, "every node read");
    assert!(
        reads.values().all(|n| *n == 1),
        "one attribute IPC per node: {reads:?}"
    );
}

#[test]
fn deadline_3000ms_returns_partial_with_cuts() {
    let mut fake = FakeAx {
        read_cost_ms: 2,
        ..FakeAx::default()
    };
    fake.window(7, 70, 1_000, 100);
    fake.tree(100, 5_000, 5);
    let mut ax = reader(fake);
    let root = ax.root("7").expect("root");
    let limits = Limits::of(&ax);
    let walked = walk(&mut ax, root.node, &limits);
    assert!(!walked.complete, "a dense window is partial");
    assert!(
        walked.elapsed_ms <= 3_000 + 250,
        "deadline honoured: {}",
        walked.elapsed_ms
    );
    assert!(walked.nodes.iter().any(|n| n.is_cut()), "the cut is data");
    assert!(walked.nodes.len() < 5_000);
}

#[test]
fn chromium_tree_wakes_without_sleep() {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.add(100, node("AXWindow"), Vec::new());
    fake.tree(101, 150, 10);
    fake.nodes.get_mut(&101).expect("web area").0.role = "AXWebArea".into();
    fake.windows.get_mut(&7).expect("window").0.bundle = Some("com.google.Chrome.canary".into());
    fake.on_poke = Some(OnPoke {
        delay: 80,
        node: 100,
        children: vec![101],
    });
    let mut ax = reader(fake);
    let root = ax.root("7").expect("root");
    assert_eq!(root.node.child_count, 1, "the web tree arrived");
    let fake = ax.server();
    assert_eq!(fake.pokes, 1, "one AXRole read starts the tree");
    assert_eq!(
        fake.now, 80,
        "woken by the observer event, no sleep and no deadline wait"
    );
    assert!(
        fake.writes.is_empty(),
        "nothing written to a Chromium app: {:?}",
        fake.writes
    );
    let limits = Limits::of(&ax);
    assert!(walk(&mut ax, root.node, &limits).nodes.len() > 100);
}

#[test]
fn electron_window_that_stays_empty_gets_manual_accessibility_only() {
    for electron in [true, false] {
        let mut fake = FakeAx::default();
        fake.window(7, 70, 1_000, 100);
        fake.add(100, node("AXWindow"), Vec::new());
        if electron {
            fake.electron.push(70);
        }
        let mut ax = reader(fake);
        let root = ax.root("7").expect("root");
        assert_eq!(root.node.child_count, 0);
        let writes: Vec<_> = ax
            .server()
            .writes
            .iter()
            .map(|(_, a, v)| (a.clone(), v.clone()))
            .collect();
        let expected = if electron {
            vec![("AXManualAccessibility".to_owned(), AxValue::Bool(true))]
        } else {
            Vec::new()
        };
        assert_eq!(writes, expected);
    }
}

#[test]
fn unknown_window_is_refused() {
    let mut ax = reader(FakeAx::default());
    assert!(ax.root("7").is_err());
    assert!(ax.root("not-a-window").is_err());
}
