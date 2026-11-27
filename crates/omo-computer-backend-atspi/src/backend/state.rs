//! What the backend keeps from the bus's events: the application roster, the last focused
//! object, the activated frames, the notification owner and when each banner arrived.

use std::collections::HashMap;

use crate::bus::{AppRef, Bus, BusEvent, NodeId, OwnerProcess, CALL_BUDGET};
use crate::types::SessionOpen;

const REGISTRY_ROOT: &str = "/org/a11y/atspi/accessible/root";

#[derive(Debug, Default)]
pub(crate) struct Roster {
    pub apps: Vec<AppRef>,
    /// An event announced an application the roster may not hold.
    pub apps_dirty: bool,
    /// The last `object:state-changed:focused` sender that gained focus.
    pub focus: Option<NodeId>,
    /// The notification daemon, looked up once per session (`None` until then).
    pub owner: Option<Option<OwnerProcess>>,
    /// The bus clock when each banner was first seen.
    pub arrivals: HashMap<NodeId, u64>,
    pub session: Option<SessionOpen>,
}

impl Roster {
    /// Folds the events the connection already holds into the roster: no round trip.
    pub fn absorb<B: Bus>(&mut self, bus: &mut B) {
        for event in bus.pending_events() {
            self.apply(&event);
        }
    }

    fn known(&self, bus_name: &str) -> bool {
        self.apps.iter().any(|app| app.node.bus == bus_name)
    }

    pub fn apply(&mut self, event: &BusEvent) {
        match event.kind.as_str() {
            "object:state-changed:focused" if event.detail == 1 => {
                self.focus = Some(event.sender.clone())
            }
            "object:state-changed:focused" if self.focus.as_ref() == Some(&event.sender) => {
                self.focus = None
            }
            "object:children-changed"
            | "object:children-changed:add"
            | "object:children-changed:remove"
                if event.sender.path == REGISTRY_ROOT =>
            {
                self.apps_dirty = true;
            }
            "window:create" | "window:activate" if !self.known(&event.sender.bus) => {
                self.apps_dirty = true
            }
            "window:destroy" => {
                self.arrivals.remove(&event.sender);
            }
            _ => {}
        }
    }

    /// Re-reads the registry when an event said it changed.
    pub fn refresh<B: Bus>(&mut self, bus: &mut B) {
        self.absorb(bus);
        if self.apps_dirty {
            if let Ok(apps) = bus.applications(CALL_BUDGET) {
                self.apps = apps;
                self.apps_dirty = false;
            }
        }
    }

    /// The registered application whose connection belongs to `pid`.
    pub fn app_of(&self, pid: u32) -> Option<&AppRef> {
        self.apps.iter().find(|app| app.pid == Some(pid))
    }
}
