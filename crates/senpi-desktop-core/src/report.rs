//! Action reports: what a mutating request returns in a session opened with
//! `reportMode: "object"`, and the one mapping from how a request settled
//! ([`Settled`]) to its [`Disposition`].
//!
//! A session opened without `reportMode` (or with `"null"`) never sees any of
//! these types: its replies stay byte-identical to protocol 1 as first
//! shipped.

use std::borrow::Cow;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::methods::Method;

/// What a mutating request returns: `null` (protocol 1 default) or an
/// `ActionReport`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub enum ReportMode {
    #[default]
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "object")]
    Object,
}

/// `retry` of a `not_delivered` disposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusedRetry {
    /// Sending the same request again cannot duplicate input.
    Safe,
    /// Only after the human acts (resume, permission, unlock, a control
    /// grant, a pause in their own typing).
    AfterUser,
}

/// `retry` of a `delivery_uncertain` disposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UncertainRetry {
    /// Sending again may duplicate input.
    Unsafe,
    /// The engine cannot tell.
    Unknown,
}

/// `retry` of a delivered disposition: always `unsafe`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnsafeRetry {
    Unsafe,
}

/// `retry` of an `unknown` disposition: always `unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnknownRetry {
    Unknown,
}

/// Whether input reached the target, and whether sending the same request
/// again could duplicate it: five delivery classes holding exactly seven
/// `(delivery, retry)` pairs. The type admits no other pair, and the
/// hand-written schema below admits the same seven.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "delivery", rename_all = "snake_case", deny_unknown_fields)]
pub enum Disposition {
    NotDelivered { retry: RefusedRetry },
    DeliveryUncertain { retry: UncertainRetry },
    DeliveredUnverified { retry: UnsafeRetry },
    DeliveredVerified { retry: UnsafeRetry },
    Unknown { retry: UnknownRetry },
}

impl Disposition {
    pub const NOT_DELIVERED_SAFE: Self = Self::NotDelivered {
        retry: RefusedRetry::Safe,
    };
    pub const NOT_DELIVERED_AFTER_USER: Self = Self::NotDelivered {
        retry: RefusedRetry::AfterUser,
    };
    pub const UNCERTAIN_UNSAFE: Self = Self::DeliveryUncertain {
        retry: UncertainRetry::Unsafe,
    };
    pub const UNCERTAIN_UNKNOWN: Self = Self::DeliveryUncertain {
        retry: UncertainRetry::Unknown,
    };
    pub const DELIVERED_UNVERIFIED: Self = Self::DeliveredUnverified {
        retry: UnsafeRetry::Unsafe,
    };
    pub const DELIVERED_VERIFIED: Self = Self::DeliveredVerified {
        retry: UnsafeRetry::Unsafe,
    };
    pub const UNKNOWN: Self = Self::Unknown {
        retry: UnknownRetry::Unknown,
    };

    /// Every disposition the wire can carry.
    pub const ALL: [Self; 7] = [
        Self::NOT_DELIVERED_SAFE,
        Self::NOT_DELIVERED_AFTER_USER,
        Self::UNCERTAIN_UNSAFE,
        Self::UNCERTAIN_UNKNOWN,
        Self::DELIVERED_UNVERIFIED,
        Self::DELIVERED_VERIFIED,
        Self::UNKNOWN,
    ];
}

impl JsonSchema for Disposition {
    fn schema_name() -> Cow<'static, str> {
        "Disposition".into()
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "description": "Whether input reached the target, and whether sending the same request again could duplicate it. Five delivery classes, seven (delivery, retry) pairs.",
            "oneOf": [
                {
                    "type": "object",
                    "properties": {
                        "delivery": {"type": "string", "const": "not_delivered"},
                        "retry": {"type": "string", "enum": ["safe", "after_user"]}
                    },
                    "required": ["delivery", "retry"],
                    "description": "Nothing reached the target. `safe`: sending again cannot duplicate input; `after_user`: only after the human acts (resume, permission, unlock, a control grant, a pause in their own typing).",
                    "additionalProperties": false
                },
                {
                    "type": "object",
                    "properties": {
                        "delivery": {"type": "string", "const": "delivery_uncertain"},
                        "retry": {"type": "string", "enum": ["unsafe", "unknown"]}
                    },
                    "required": ["delivery", "retry"],
                    "description": "Input may have reached the target. `unsafe`: sending again may duplicate it; `unknown`: the engine cannot tell. Read the target first.",
                    "additionalProperties": false
                },
                {
                    "type": "object",
                    "properties": {
                        "delivery": {"type": "string", "const": "delivered_unverified"},
                        "retry": {"type": "string", "const": "unsafe"}
                    },
                    "required": ["delivery", "retry"],
                    "description": "Input was delivered, in full or up to `delivered.count`, and its effect was not read back.",
                    "additionalProperties": false
                },
                {
                    "type": "object",
                    "properties": {
                        "delivery": {"type": "string", "const": "delivered_verified"},
                        "retry": {"type": "string", "const": "unsafe"}
                    },
                    "required": ["delivery", "retry"],
                    "description": "Input was delivered in full and its effect was read back.",
                    "additionalProperties": false
                },
                {
                    "type": "object",
                    "properties": {
                        "delivery": {"type": "string", "const": "unknown"},
                        "retry": {"type": "string", "const": "unknown"}
                    },
                    "required": ["delivery", "retry"],
                    "description": "The engine cannot say what happened: an internal error, an epoch change during input, a reply quarantined after a stop, or an engine restart.",
                    "additionalProperties": false
                }
            ]
        })
    }
}

/// Partial delivery, `count <= of`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Delivered {
    /// Units delivered: Unicode scalars for typed text.
    pub count: u32,
    /// Units requested.
    pub of: u32,
}

/// What a read-back of the target showed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionEffect {
    Confirmed,
    Unverifiable,
    NoChange,
    /// Only in SDK batch reports, never in an engine reply.
    Refused,
}

/// The channel the input took.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionRoute {
    Ax,
    BackgroundWindow,
    BackgroundPid,
    ForegroundHid,
}

/// The front window and key window after the action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FocusRestoration {
    NotNeeded,
    Restored,
    UserMovedOn,
    NotConfirmed,
}

impl FocusRestoration {
    /// The transaction's `focus_restored` (`None` when nothing was captured).
    #[must_use]
    pub const fn from_restored(restored: Option<bool>) -> Self {
        match restored {
            None => Self::NotNeeded,
            Some(true) => Self::Restored,
            Some(false) => Self::NotConfirmed,
        }
    }
}

/// The element under the point before input was sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionHit {
    pub role: String,
    /// `null` for a secure field or an element without a label.
    #[serde(default)]
    pub label: Option<String>,
}

/// A surface the action opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenedSurface {
    /// Open token set: `sheet`, `dialog`, `menu`, `popover`, `window`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub ref_: Option<String>,
}

/// How long each stage of one mutating request took, in microseconds. A
/// stage the request did not run is absent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StageTimings {
    /// Resolving an accessibility ref to its element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ax_resolve: Option<u64>,
    /// Capturing the focus and cursor state the request restores.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture: Option<u64>,
    /// Making the target window key before background keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prime: Option<u64>,
    /// Sending the input itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch: Option<u64>,
    /// The checks after the input was sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<u64>,
    /// Restoring focus and cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<u64>,
}

/// The suggested next request; never followed automatically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NextCall {
    pub method: Method,
    /// Params of `method`.
    pub args: Map<String, Value>,
}

/// Result of a mutating request in a session opened with
/// `reportMode: "object"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionReport {
    pub disposition: Disposition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered: Option<Delivered>,
    pub effect: ActionEffect,
    /// Absent when the engine does not name the channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<ActionRoute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hit: Option<ActionHit>,
    pub focus_restoration: FocusRestoration,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opened_surfaces: Vec<OpenedSurface>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_call: Option<NextCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Open token set, e.g. `secure_field`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    /// Per-stage durations; only in a session opened with `trace: true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timings: Option<StageTimings>,
    /// Ids of the `audit` notifications this request emitted.
    #[schemars(length(min = 1))]
    pub audit_ids: Vec<String>,
}

/// How much of a request's input was sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Progress {
    /// One indivisible action, or one whose units are not counted.
    Atomic,
    /// `count` of `of` units (Unicode scalars of typed text) were sent.
    Counted { count: u32, of: u32 },
}

/// How a request that sent input ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum End {
    /// Every unit was sent; `verified` when its effect was read back.
    Completed { verified: bool },
    /// A stop, a cancellation or the user ended it between units.
    Interrupted { needs_user: bool },
    /// It failed in a way that may have sent input; `repeat_known` when
    /// repeating it is known to risk a duplicate.
    Uncertain { repeat_known: bool },
}

/// How a mutating request settled, as the session observed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Settled {
    /// Refused before any input was sent.
    Refused { needs_user: bool },
    /// Input was being sent.
    Ran { progress: Progress, end: End },
    /// The engine cannot say what happened.
    Unknowable,
}

impl Settled {
    /// A run, or `None` for an impossible shape: more units than requested,
    /// or a completed run that sent fewer than requested.
    #[must_use]
    pub const fn ran(progress: Progress, end: End) -> Option<Self> {
        if let Progress::Counted { count, of } = progress {
            if count > of || (count < of && matches!(end, End::Completed { .. })) {
                return None;
            }
        }
        Some(Self::Ran { progress, end })
    }

    /// The one mapping from how a request settled to its disposition.
    #[must_use]
    pub const fn disposition(&self) -> Disposition {
        match *self {
            Self::Refused { needs_user } => refused(needs_user),
            Self::Unknowable => Disposition::UNKNOWN,
            Self::Ran { progress, end } => match end {
                End::Interrupted { needs_user }
                    if matches!(progress, Progress::Counted { count: 0, .. }) =>
                {
                    refused(needs_user)
                }
                End::Interrupted { .. } | End::Completed { verified: false } => {
                    Disposition::DELIVERED_UNVERIFIED
                }
                End::Completed { verified: true } => Disposition::DELIVERED_VERIFIED,
                End::Uncertain { repeat_known: true } => Disposition::UNCERTAIN_UNSAFE,
                End::Uncertain {
                    repeat_known: false,
                } => Disposition::UNCERTAIN_UNKNOWN,
            },
        }
    }

    /// The counted units of a run.
    #[must_use]
    pub const fn delivered(&self) -> Option<Delivered> {
        match *self {
            Self::Ran {
                progress: Progress::Counted { count, of },
                ..
            } => Some(Delivered { count, of }),
            Self::Ran {
                progress: Progress::Atomic,
                ..
            }
            | Self::Refused { .. }
            | Self::Unknowable => None,
        }
    }
}

const fn refused(needs_user: bool) -> Disposition {
    if needs_user {
        Disposition::NOT_DELIVERED_AFTER_USER
    } else {
        Disposition::NOT_DELIVERED_SAFE
    }
}

#[cfg(test)]
#[path = "report_tests.rs"]
mod tests;
