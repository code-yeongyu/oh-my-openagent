//! The window query: the windows of an app the window list alone does not give, read without
//! activating anything or switching a Space. AX lists the current Space's windows; their
//! sheets and popovers are AX children (read breadth-first under a node budget); the windows on
//! other Spaces come from the window list. A window is reported once.

use std::collections::{BTreeSet, VecDeque};

use super::seam::{FoundWindow, WindowOs};

/// The AX roles of window-like children.
const WINDOW_LIKE: [&str; 4] = ["AXWindow", "AXSheet", "AXPopover", "AXDrawer"];
/// AX nodes whose children one query reads at most.
pub const NODE_BUDGET: usize = 512;

/// Every window of `pid` the query can find.
pub fn query(os: &mut dyn WindowOs, pid: u32) -> Vec<FoundWindow> {
    let windows = os.app_windows(pid);
    let mut out: Vec<FoundWindow> = windows.iter().map(|n| n.found.clone()).collect();
    let mut queue = VecDeque::from(windows);
    let mut read = 0;
    while let Some(node) = queue.pop_front() {
        if read >= NODE_BUDGET {
            break;
        }
        read += 1;
        for child in os.children(node.id) {
            if WINDOW_LIKE.contains(&child.found.role.as_str()) {
                out.push(child.found.clone());
            }
            queue.push_back(child);
        }
    }
    let known: BTreeSet<u32> = out.iter().filter_map(|w| w.number).collect();
    out.extend(
        os.listed_windows(pid)
            .into_iter()
            .filter(|w| w.number.is_some_and(|n| !known.contains(&n))),
    );
    out
}
