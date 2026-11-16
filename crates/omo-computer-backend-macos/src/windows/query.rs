//! The window query: the windows of an app the window list alone does not give, read without
//! activating anything or switching a Space. AX lists the current Space's windows; their
//! sheets and popovers are AX children; the windows on other Spaces come from the window list.

use super::seam::{FoundWindow, WindowOs};

/// Every window of `pid` the query can find.
pub fn query(os: &mut dyn WindowOs, pid: u32) -> Vec<FoundWindow> {
    os.app_windows(pid).into_iter().map(|n| n.found).collect()
}
