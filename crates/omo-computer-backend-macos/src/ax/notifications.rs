//! The macOS notification surface (RED stub).

use super::seam::Notified;

pub const SURFACE_BUNDLE: &str = "com.apple.notificationcenterui";

#[derive(Debug, Default)]
pub struct Surface {
    pub pid: Option<u32>,
}

impl Surface {
    pub fn note(&mut self, event: &Notified, now_ms: u64) {
        let _ = (event, now_ms);
    }
}

#[must_use]
pub fn body_hash(parts: &[&str]) -> String {
    parts.join("")
}
