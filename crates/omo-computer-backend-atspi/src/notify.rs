//! The Linux notification surface of `waitFor({notification})`: the banners of the
//! `org.freedesktop.Notifications` name owner, read on the ONE accessibility connection.
//! The owner is found once per session; a banner keeps the fingerprint and arrival time it
//! had when first seen.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use crate::backend::AtspiBackend;
use crate::bus::{read_slice, Bus, NodeId};
use crate::types::{AxRefusal, Fingerprint};

const BANNER_ROLES: &[&str] = &["notification", "alert"];
const BANNER_DEPTH: u32 = 4;
const SLICE_MS: u64 = 250;

fn no_surface() -> AxRefusal {
    AxRefusal::plain(Refusal::new(
        EngineCode::Internal,
        Reason::NoNotificationSurface.wire(),
    ))
}

fn hash(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// The text under a banner: every name and text below it, in document order.
fn body<B: Bus>(bus: &mut B, node: &NodeId, depth: u32, out: &mut Vec<String>) {
    let slice = read_slice(SLICE_MS);
    for kid in bus.children(node, slice).unwrap_or_default() {
        if let Ok(facts) = bus.read(&kid, slice) {
            out.extend(facts.name.filter(|name| !name.is_empty()));
            if facts.interfaces.text {
                out.extend(bus.text(&kid, slice).ok().filter(|text| !text.is_empty()));
            }
            if depth > 0 {
                body(bus, &kid, depth - 1, out);
            }
        }
    }
}

fn banners<B: Bus>(bus: &mut B, node: &NodeId, depth: u32, found: &mut Vec<(NodeId, String)>) {
    let slice = read_slice(SLICE_MS);
    for kid in bus.children(node, slice).unwrap_or_default() {
        let Ok(facts) = bus.read(&kid, slice) else {
            continue;
        };
        if BANNER_ROLES.contains(&facts.role.as_str()) {
            found.push((kid, facts.name.unwrap_or_default()));
        } else if depth > 0 {
            banners(bus, &kid, depth - 1, found);
        }
    }
}

impl<B: Bus> AtspiBackend<B> {
    /// The banners on screen, as `Fingerprint{app, title, bodyHash, arrivedAt}`.
    ///
    /// # Errors
    /// No bus, or no notification daemon on the session bus / on the accessibility bus
    /// (`Internal{no_notification_surface}`).
    pub fn notifications(&mut self) -> Result<Vec<Fingerprint>, AxRefusal> {
        let bus = self.bus.as_mut().ok_or_else(AxRefusal::no_bus)?;
        if self.roster.owner.is_none() {
            self.roster.owner = Some(bus.notification_owner().ok().flatten());
        }
        let owner = self.roster.owner.clone().flatten().ok_or_else(no_surface)?;
        self.roster.refresh(bus);
        let app = self
            .roster
            .app_of(owner.pid)
            .cloned()
            .ok_or_else(no_surface)?;
        let mut found = Vec::new();
        banners(bus, &app.node, BANNER_DEPTH, &mut found);
        let mut prints = Vec::with_capacity(found.len());
        for (node, title) in found {
            let mut text = Vec::new();
            body(bus, &node, 2, &mut text);
            let now = bus.now_ms();
            let arrived_at = *self.roster.arrivals.entry(node).or_insert(now);
            prints.push(Fingerprint {
                app: owner.name.clone(),
                title,
                body_hash: hash(&text.join("\n")),
                arrived_at,
            });
        }
        Ok(prints)
    }
}
