//! The bounded walk against a scripted reader whose every read costs scripted time.

use std::collections::BTreeSet;

use super::*;
use crate::backend::{BackendResult, Refusal};
use crate::error::EngineCode;

/// A tree of `groups` groups under one root, each with `leaves` leaves. A batch costs
/// `ms_per_batch` and returns at most `per_batch` nodes; the groups in `hung` never answer.
struct Scripted {
    now: u64,
    groups: u32,
    leaves: u32,
    per_batch: u32,
    ms_per_batch: u64,
    hung: BTreeSet<u64>,
    slices: Vec<u64>,
}

impl Scripted {
    fn new(groups: u32, leaves: u32) -> Self {
        Self { now: 0, groups, leaves, per_batch: 100, ms_per_batch: 1, hung: BTreeSet::new(), slices: Vec::new() }
    }

    fn node(handle: u64, role: &str, child_count: u32) -> NodeRead {
        NodeRead {
            handle: Some(AxHandle(handle)),
            role: role.to_owned(),
            title: Some(format!("{role} {handle}")),
            child_count,
            evidence: Evidence::of(true, false, false),
            ..NodeRead::default()
        }
    }
}

impl AxReader for Scripted {
    fn now_ms(&self) -> u64 {
        self.now
    }

    fn root(&mut self, _window: &str) -> BackendResult<RootRead> {
        Err(Refusal::bare(EngineCode::AxFailed))
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        self.slices.push(slice_ms);
        if self.hung.contains(&parent.0) {
            self.now += slice_ms;
            return Slice::Hung;
        }
        self.now += self.ms_per_batch.min(slice_ms);
        let (count, role, base, grandchildren) = if parent.0 == 0 {
            (self.groups, "group", 1, self.leaves)
        } else {
            (self.leaves, "button", parent.0 * 100_000, 0)
        };
        let end = count.min(from + self.per_batch);
        Slice::Read((from..end).map(|i| Self::node(base + u64::from(i), role, grandchildren)).collect())
    }

    fn node(&mut self, _handle: AxHandle, _slice_ms: u64) -> Slice<Option<NodeRead>> {
        Slice::Read(None)
    }
}

fn run(reader: &mut Scripted) -> Walk {
    let groups = reader.groups;
    let limits = Limits::of(reader);
    walk(reader, Scripted::node(0, "window", groups), &limits)
}

#[test]
fn read_stops_at_2000_nodes_and_250ms_slices() {
    // Budget: 10 x 500 leaves under one root is 5,011 nodes; the read stops at 2,000.
    let mut dense = Scripted::new(10, 500);
    let read = run(&mut dense);
    assert_eq!(read.nodes.len(), 2_000, "the node budget");
    assert!(!read.complete);
    let cut: Vec<&WalkNode> = read.nodes.iter().filter(|node| node.is_cut()).collect();
    assert!(!cut.is_empty());
    let unread: u32 = read.nodes.iter().map(|node| node.read.child_count - node.children_read).sum();
    assert_eq!(unread, 5_011 - 2_000, "every node left out sits under a flagged cut");
    assert!(dense.slices.iter().all(|slice| *slice <= SLICE_MS), "{:?}", dense.slices);

    // A hung control costs one slice and is unknown on that node only; the rest is read.
    let mut hung = Scripted::new(3, 5);
    hung.hung.insert(2);
    let read = run(&mut hung);
    assert_eq!(read.nodes.len(), 1 + 3 + 10);
    let stuck: Vec<&WalkNode> = read.nodes.iter().filter(|node| node.hung).collect();
    assert_eq!(stuck.len(), 1);
    assert_eq!(stuck[0].read.handle, Some(AxHandle(2)));
    assert!(stuck[0].is_cut() && !read.complete);
    assert_eq!(hung.slices.iter().filter(|slice| **slice == SLICE_MS).count(), 4, "every slice is offered whole: {:?}", hung.slices);

    // Deadline: batches of 400 ms are cut to 250 ms slices, and the walk ends inside 3,000 ms.
    let mut slow = Scripted::new(40, 40);
    slow.ms_per_batch = 400;
    slow.per_batch = 10;
    let read = run(&mut slow);
    assert!(read.elapsed_ms <= DEADLINE_MS, "elapsed {}", read.elapsed_ms);
    assert!(slow.slices.iter().all(|slice| *slice <= SLICE_MS));
    assert!(!read.complete && read.nodes.len() < 1_641);

    // Under every limit the walk is complete and in document order.
    let mut small = Scripted::new(2, 2);
    let read = run(&mut small);
    assert!(read.complete);
    let order: Vec<u64> = read.nodes.iter().filter_map(|node| node.read.handle.map(|h| h.0)).collect();
    assert_eq!(order, vec![0, 1, 100_000, 100_001, 2, 200_000, 200_001]);
}

#[test]
fn ref_tokens_parse_only_the_two_spellings() {
    assert_eq!(RefToken::parse("s7:e4"), Some(RefToken::Qualified { generation: 7, n: 4 }));
    assert_eq!(RefToken::parse("e9999"), Some(RefToken::Bare { n: 9999 }));
    for bad in ["", "e", "e0", "s:e1", "s1:e", "s1e2", "s-1:e2", "s1:e+2", "S1:E2", "s1:e2:e3", " e1", "e1 "] {
        assert_eq!(RefToken::parse(bad), None, "{bad:?}");
    }
    assert_eq!(RefToken::Qualified { generation: 8, n: 4 }.to_string(), "s8:e4");
}

#[test]
fn wrappers_are_anonymous_scroll_only_containers() {
    let mut wrapper = NodeRead { role: "group".into(), child_count: 1, ..NodeRead::default() };
    wrapper.actions = vec!["AXScrollToVisible".into()];
    assert!(is_wrapper(&wrapper));
    for named in [
        NodeRead { title: Some("Toolbar".into()), ..wrapper.clone() },
        NodeRead { native_id: Some("main".into()), ..wrapper.clone() },
        NodeRead { actions: vec!["press".into()], ..wrapper.clone() },
        NodeRead { child_count: 0, ..wrapper.clone() },
        NodeRead { evidence: Evidence { title: Seen::Unknown, ..Evidence::default() }, ..wrapper.clone() },
    ] {
        assert!(!is_wrapper(&named), "{named:?}");
    }
}
