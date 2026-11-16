//! The macOS notification surface for `waitFor({notification})`: banners of
//! `com.apple.notificationcenterui`, read through AX on the settle's own observer registration
//! (armed at the first read, kept for the session; 0 polls). Fingerprint per banner: the first
//! static text (else the banner's description) is the app, the second the title, and the rest
//! joined is hashed (sha256, first 16 bytes); `arrivedAt` is the `AXWindowCreated` time.

use std::collections::{BTreeMap, VecDeque};

use omo_computer_core::ax::{Slice, SLICE_MS};
use omo_computer_core::backend::{BackendResult, NotificationFingerprint, NO_NOTIFICATION_SURFACE};
use sha2::{Digest, Sha256};

use super::reader::{MacAx, CHILD_BATCH};
use super::seam::{AxServer, Element, Notified};

pub const SURFACE_BUNDLE: &str = "com.apple.notificationcenterui";
/// Elements read per banner at most.
const BANNER_NODE_BUDGET: usize = 64;

/// The surface's process and the arrival time of each banner window.
#[derive(Debug, Default)]
pub struct Surface {
    pub pid: Option<u32>,
    arrivals: BTreeMap<Element, u64>,
}

impl Surface {
    /// An observer event of the surface's process: a created window is a banner arrival.
    pub fn note(&mut self, event: &Notified, now_ms: u64) {
        if event.notification == "AXWindowCreated" {
            self.arrivals.insert(event.element, now_ms);
        }
    }
}

/// `sha256_16` of the body parts joined by newlines, as lowercase hex.
#[must_use]
pub fn body_hash(parts: &[&str]) -> String {
    let digest = Sha256::digest(parts.join("\n").as_bytes());
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// The banners the surface shows now.
///
/// # Errors
/// [`NO_NOTIFICATION_SURFACE`] when no Notification Center process runs for the user.
pub fn read<S: AxServer>(ax: &mut MacAx<S>) -> BackendResult<Vec<NotificationFingerprint>> {
    let pid = ax
        .server
        .process_of_bundle(SURFACE_BUNDLE)
        .ok_or(NO_NOTIFICATION_SURFACE)?;
    ax.surface.pid = Some(pid);
    ax.ensure_observed(pid);
    let app = ax.server.app(pid).ok_or(NO_NOTIFICATION_SURFACE)?;
    let Slice::Read(windows) = ax.server.children(app, 0, CHILD_BATCH, SLICE_MS) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for window in windows {
        let (texts, description) = texts(&mut ax.server, window);
        let mut parts = texts.iter().map(String::as_str);
        let Some(app_name) = parts.next().map(str::to_owned).or(description) else {
            continue;
        };
        let title = parts.next().unwrap_or_default().to_owned();
        let body: Vec<&str> = parts.collect();
        let now = ax.server.now_ms();
        let arrived = *ax.surface.arrivals.entry(window).or_insert(now);
        out.push(NotificationFingerprint {
            app: app_name,
            title,
            body_hash: body_hash(&body),
            arrived_at_ms: arrived,
        });
    }
    Ok(out)
}

/// The `AXStaticText` values under a banner in document order, and the banner's description.
fn texts(server: &mut dyn AxServer, banner: Element) -> (Vec<String>, Option<String>) {
    let mut texts = Vec::new();
    let mut description = None;
    let mut queue = VecDeque::from([banner]);
    let mut read = 0;
    while let Some(element) = queue.pop_front() {
        if read >= BANNER_NODE_BUDGET {
            break;
        }
        read += 1;
        let Slice::Read(Some(attributes)) = server.read(element, SLICE_MS) else {
            continue;
        };
        if element == banner {
            description = attributes.description.clone();
        }
        if attributes.role == "AXStaticText" {
            if let Some(text) = attributes.value.or(attributes.title) {
                texts.push(text);
            }
        }
        if attributes.child_count > 0 {
            if let Slice::Read(children) = server.children(element, 0, CHILD_BATCH, SLICE_MS) {
                queue.extend(children);
            }
        }
    }
    (texts, description)
}
