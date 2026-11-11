//! `waitFor` and its closed predicate set (acceptance 87). A predicate written as a
//! function stays in the SDK; the wire carries one of these shapes.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::SettleOptions;
use crate::listing::SurfaceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ElementState {
    Enabled,
    Visible,
    Gone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WindowState {
    Appeared,
    Gone,
    Focused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceState {
    Appeared,
    Gone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Focus,
    Structure,
    Property,
    WindowOpened,
    WindowClosed,
}

params! { WindowPredicate { state: WindowState; title: String, app: String, } }
params! { SurfacePredicate { kind: SurfaceKind, state: SurfaceState; } }
params! { NotificationPredicate { ; app: String, title: String, } }
params! { EventPredicate { kind: EventKind; } }
params! {
    SessionPredicate {
        ;
        screen_locked: bool, display_asleep: bool, session_active: bool, secure_input_active: bool, user_active: bool,
    }
}

/// One `waitFor` predicate; each is bounded by the call's `timeout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum WaitPredicate {
    Settle {
        settle: SettleOptions,
    },
    Text {
        text: String,
    },
    Element {
        #[serde(rename = "ref")]
        reference: String,
        state: ElementState,
    },
    Window {
        window: WindowPredicate,
    },
    Surface {
        surface: SurfacePredicate,
    },
    Notification {
        notification: NotificationPredicate,
    },
    Event {
        event: EventPredicate,
    },
    Session {
        session: SessionPredicate,
    },
}

params! { WaitForParams { target: String, predicate: WaitPredicate; timeout: u64, } }
