//! Presence exclusion (d-windows.md '## Capture guard and input lock', Presence):
//! `capabilities().presence.exclusion` is `affinity` only when the spike's affinity row CONFIRMS
//! that `WDA_EXCLUDEFROMCAPTURE` keeps the overlay out of captures (SP-N #13145@e0e08a126e:
//! n-affinity-wgc-monitor, n-affinity-printwindow-overlapped, n-affinity-wgc-window-overlapped,
//! n-affinity-gdi-bitblt) AND the live cover-window oracle reads 0 leaked pixels; otherwise
//! `hide_ack`: the overlay is hidden and acknowledged before every model-bound capture.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exclusion {
    Affinity,
    HideAck,
}

/// `leaked_px` is the cover-window oracle's reading on this build, `None` when not measured.
#[must_use]
pub const fn exclusion(spike_confirms: bool, leaked_px: Option<u64>) -> Exclusion {
    match (spike_confirms, leaked_px) {
        (true, Some(0)) => Exclusion::Affinity,
        _ => Exclusion::HideAck,
    }
}
