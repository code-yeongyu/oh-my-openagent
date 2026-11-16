//! The session-level reads: the `org.a11y.Status.IsEnabled` write audited once per session,
//! focus from events, the loading predicate (A4 `busy`) and the web document's `URI`.

use omo_computer_core::backend::BackendResult;
use omo_computer_core::observation::BusyIndicator;

use super::observe::ROOT_SLICE_MS;
use super::AtspiBackend;
use crate::bus::{read_slice, Bus, NodeId};
use crate::types::{A11yAudit, AxRefusal, SessionOpen};

/// How far up the tree the `document web` ancestor of the focus is looked for.
const DOCUMENT_DEPTH: usize = 24;

impl<B: Bus> AtspiBackend<B> {
    /// At `session.open`: reads `IsEnabled`, writes `true` when it was off and audits the
    /// write with its before value, once per session. Apps already running may need a restart
    /// to appear on the bus.
    pub fn open_session(&mut self) -> SessionOpen {
        if let Some(done) = self.roster.session {
            return done;
        }
        let Some(bus) = self.bus.as_mut() else {
            return SessionOpen::default();
        };
        let opened = match bus.a11y_enabled() {
            Ok(true) => SessionOpen::default(),
            Ok(false) => match bus.set_a11y_enabled(true) {
                Ok(()) => SessionOpen {
                    audit: Some(A11yAudit { before: false }),
                    write_refused: false,
                },
                Err(_) => SessionOpen {
                    audit: None,
                    write_refused: true,
                },
            },
            Err(_) => SessionOpen {
                audit: None,
                write_refused: true,
            },
        };
        self.roster.session = Some(opened);
        opened
    }

    /// The focused object, from the last focus event, verified with one read: no walk over
    /// any application.
    ///
    /// # Errors
    /// No bus.
    pub fn focused(&mut self) -> BackendResult<Option<NodeId>> {
        let bus = self.bus.as_mut().ok_or_else(super::ax_unavailable)?;
        self.roster.absorb(bus);
        let Some(focus) = self.roster.focus.clone() else {
            return Ok(None);
        };
        let held = bus
            .read(&focus, read_slice(ROOT_SLICE_MS))
            .is_ok_and(|facts| facts.states.focused);
        if !held {
            self.roster.focus = None;
        }
        Ok(held.then_some(focus))
    }

    /// Waits until the application of `pid` is on the bus, on the bus's events (no sleep, no
    /// poll loop); one last registry read at the deadline. `false` when it never appeared.
    pub fn wait_for_app(&mut self, pid: u32, timeout_ms: u64) -> bool {
        let Some(bus) = self.bus.as_mut() else {
            return false;
        };
        let deadline = bus.now_ms().saturating_add(timeout_ms);
        loop {
            self.roster.refresh(bus);
            if self.roster.app_of(pid).is_some() {
                return true;
            }
            let left = deadline.saturating_sub(bus.now_ms());
            if left == 0 {
                self.roster.apps_dirty = true;
                self.roster.refresh(bus);
                return self.roster.app_of(pid).is_some();
            }
            match bus.wait_event(std::time::Duration::from_millis(left)) {
                Ok(Some(event)) => self.roster.apply(&event),
                Ok(None) => {}
                Err(_) => return false,
            }
        }
    }

    /// Waits for the next event on the bus inside `timeout_ms` and folds it into the roster;
    /// `false` when none came. Callers re-read after it instead of sleeping.
    pub fn await_event(&mut self, timeout_ms: u64) -> bool {
        let Some(bus) = self.bus.as_mut() else {
            return false;
        };
        match bus.wait_event(std::time::Duration::from_millis(timeout_ms)) {
            Ok(Some(event)) => {
                self.roster.apply(&event);
                true
            }
            _ => false,
        }
    }

    /// The loading predicate of amendment A4: the window's frame reports `busy`.
    pub fn busy(&mut self, window: &str) -> Option<BusyIndicator> {
        let frame = self.frame_for(window).ok()?;
        let bus = self.bus.as_mut()?;
        let facts = bus.read(&frame.node, read_slice(ROOT_SLICE_MS)).ok()?;
        facts.states.busy.then_some(BusyIndicator::AxBusy)
    }

    /// The `URI` of the focused `document web` object in `window` (the `url_policy` read):
    /// the focus itself or its nearest `document web` ancestor; `None` when the focus is not in
    /// a web document.
    ///
    /// # Errors
    /// No bus, or the window's join refusal.
    pub fn document_url(&mut self, window: &str) -> Result<Option<String>, AxRefusal> {
        let frame = self.frame_for(window)?;
        let bus = self.bus.as_mut().ok_or_else(AxRefusal::no_bus)?;
        self.roster.absorb(bus);
        let mut cursor = self
            .roster
            .focus
            .clone()
            .filter(|focus| focus.bus == frame.node.bus);
        let slice = read_slice(ROOT_SLICE_MS);
        for _ in 0..DOCUMENT_DEPTH {
            let Some(node) = cursor else { return Ok(None) };
            let Ok(facts) = bus.read(&node, slice) else {
                return Ok(None);
            };
            if facts.role == "document web" {
                let attributes = bus.attributes(&node, slice).unwrap_or_default();
                let uri = attributes
                    .into_iter()
                    .find(|(key, _)| key == "URI" || key == "DocURL");
                return Ok(uri.map(|(_, value)| value));
            }
            cursor = bus
                .parent(&node, slice)
                .ok()
                .flatten()
                .filter(|parent| *parent != frame.node);
        }
        Ok(None)
    }
}
