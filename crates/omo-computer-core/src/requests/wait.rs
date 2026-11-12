//! The reader of the `waitFor` predicate set.

use super::options::{read_settle, SettleSpec};
use crate::listing::SurfaceKind;
use crate::params::{
    ElementState, EventKind, EventPredicate, NotificationPredicate, SessionPredicate,
    SurfacePredicate, SurfaceState, WaitPredicate, WindowPredicate, WindowState,
};

/// The session fields a `waitFor({session})` waits to match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionMatch {
    pub screen_locked: Option<bool>,
    pub display_asleep: Option<bool>,
    pub session_active: Option<bool>,
    pub secure_input_active: Option<bool>,
    pub user_active: Option<bool>,
}

/// What a `waitFor` waits for, fed by the settle and the AX observers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaitSpec {
    Settle(SettleSpec),
    Text(String),
    Element {
        reference: String,
        state: ElementState,
    },
    Window {
        state: WindowState,
        title: Option<String>,
        app: Option<String>,
    },
    Surface {
        kind: SurfaceKind,
        state: SurfaceState,
    },
    Notification {
        app: Option<String>,
        title: Option<String>,
    },
    Event(EventKind),
    Session(SessionMatch),
}

fn read_window_predicate(predicate: WindowPredicate) -> WaitSpec {
    let WindowPredicate { state, title, app } = predicate;
    WaitSpec::Window { state, title, app }
}

fn read_surface_predicate(predicate: SurfacePredicate) -> WaitSpec {
    let SurfacePredicate { kind, state } = predicate;
    WaitSpec::Surface { kind, state }
}

fn read_notification_predicate(predicate: NotificationPredicate) -> WaitSpec {
    let NotificationPredicate { app, title } = predicate;
    WaitSpec::Notification { app, title }
}

fn read_event_predicate(predicate: EventPredicate) -> WaitSpec {
    let EventPredicate { kind } = predicate;
    WaitSpec::Event(kind)
}

fn read_session_predicate(predicate: SessionPredicate) -> WaitSpec {
    let SessionPredicate {
        screen_locked,
        display_asleep,
        session_active,
        secure_input_active,
        user_active,
    } = predicate;
    WaitSpec::Session(SessionMatch {
        screen_locked,
        display_asleep,
        session_active,
        secure_input_active,
        user_active,
    })
}

#[must_use]
pub fn read_wait_predicate(predicate: WaitPredicate) -> WaitSpec {
    match predicate {
        WaitPredicate::Settle { settle } => WaitSpec::Settle(read_settle(settle)),
        WaitPredicate::Text { text } => WaitSpec::Text(text),
        WaitPredicate::Element { reference, state } => WaitSpec::Element { reference, state },
        WaitPredicate::Window { window } => read_window_predicate(window),
        WaitPredicate::Surface { surface } => read_surface_predicate(surface),
        WaitPredicate::Notification { notification } => read_notification_predicate(notification),
        WaitPredicate::Event { event } => read_event_predicate(event),
        WaitPredicate::Session { session } => read_session_predicate(session),
    }
}
