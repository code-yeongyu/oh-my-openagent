//! The value members of an `ActionReport`: effect, route, focus restoration, hit,
//! delivered counts and stage timings.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::backend;

/// What the engine can say the action did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Effect {
    /// A receipt for this verb proves the requested effect.
    Confirmed,
    /// The engine read the target after the send; the read is not proof the input caused it.
    Observed,
    /// Part of the request landed; `delivered` carries the counts.
    Partial,
    /// Nothing proves or reads the effect.
    Unverifiable,
    /// Sent exactly once into a childless hit in a suspect viewport, and nothing changed.
    SuspectedNoop,
    /// Kept in the union so older shapes still parse; the engine never produces it.
    NoChange,
    /// Nothing was sent.
    Refused,
}

impl Effect {
    pub const ALL: [Self; 7] = [
        Self::Confirmed,
        Self::Observed,
        Self::Partial,
        Self::Unverifiable,
        Self::SuspectedNoop,
        Self::NoChange,
        Self::Refused,
    ];
}

/// The delivery route the input took.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    Ax,
    BackgroundWindow,
    BackgroundPid,
    ForegroundHid,
}

impl From<backend::Route> for Route {
    fn from(route: backend::Route) -> Self {
        match route {
            backend::Route::Ax => Self::Ax,
            backend::Route::BackgroundWindow => Self::BackgroundWindow,
            backend::Route::BackgroundPid => Self::BackgroundPid,
            backend::Route::ForegroundHid => Self::ForegroundHid,
        }
    }
}

/// Where focus ended after the action. A background action touches no focus: `untouched`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FocusRestoration {
    Untouched,
    Restored,
    UserMovedOn,
    Failed,
}

impl FocusRestoration {
    pub const ALL: [Self; 4] = [
        Self::Untouched,
        Self::Restored,
        Self::UserMovedOn,
        Self::Failed,
    ];
}

/// The element read under the point before the send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Hit {
    pub role: String,
    pub label: Option<String>,
}

/// How many units of an interrupted send went out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Delivered {
    pub count: u32,
    pub of: u32,
}

impl From<backend::Delivered> for Delivered {
    fn from(delivered: backend::Delivered) -> Self {
        Self {
            count: delivered.count,
            of: delivered.of,
        }
    }
}

/// Stage timings in microseconds; a stage that did not run is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Timings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ax_resolve: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prime: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<u64>,
}
