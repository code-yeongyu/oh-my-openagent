//! `evidence[]` entries. An entry's class is derived from its kind and, for a value
//! read-back, from its own equality check: `barrier_consumed` and `xi2_raw_confirm` are
//! receipts, a `value_readback` whose `value` equals its `intended` is a receipt, and every
//! other entry is an observation. The constructors derive the class; the wire parse
//! refuses an entry whose tagged class differs from the derived one.

use std::borrow::Cow;

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

use super::rejection::ReportRejection;

/// What an evidence entry read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    /// Windows hook-free barrier: the target dequeued the input.
    BarrierConsumed,
    /// X11 MPX raw XI2 event: the server consumed and re-emitted the input.
    Xi2RawConfirm,
    /// The target's value read back after the send.
    ValueReadback,
    /// The focused element read back after the send.
    FocusReadback,
    /// The menu state read back after the send.
    MenuReadback,
    /// An event from an observer registered on the target window before the send.
    AxNotification,
    /// Pixels changed in the hit region or the window during the settle window.
    SettleFrameDiff,
    /// A window-wide accessibility change during the settle window.
    AxChange,
}

impl EvidenceKind {
    pub const ALL: [Self; 8] = [
        Self::BarrierConsumed,
        Self::Xi2RawConfirm,
        Self::ValueReadback,
        Self::FocusReadback,
        Self::MenuReadback,
        Self::AxNotification,
        Self::SettleFrameDiff,
        Self::AxChange,
    ];

    /// A read of the target after the send: what makes an effect `observed`.
    #[must_use]
    pub const fn reads_target(self) -> bool {
        matches!(
            self,
            Self::ValueReadback | Self::FocusReadback | Self::MenuReadback | Self::AxNotification
        )
    }
}

/// Receipt or observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceClass {
    Receipt,
    Observation,
}

/// One `evidence[]` entry; its class always equals the derived class.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "WireEvidence", rename_all = "camelCase")]
pub struct Evidence {
    kind: EvidenceKind,
    class: EvidenceClass,
    #[serde(skip_serializing_if = "Option::is_none")]
    intended: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    baseline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event: Option<String>,
}

impl Evidence {
    /// The class an entry of `kind` carrying `intended` and `value` has.
    #[must_use]
    pub fn derived_class(
        kind: EvidenceKind,
        intended: Option<&str>,
        value: Option<&str>,
    ) -> EvidenceClass {
        match kind {
            EvidenceKind::BarrierConsumed | EvidenceKind::Xi2RawConfirm => EvidenceClass::Receipt,
            EvidenceKind::ValueReadback if intended.is_some() && intended == value => {
                EvidenceClass::Receipt
            }
            _ => EvidenceClass::Observation,
        }
    }

    #[must_use]
    pub fn barrier_consumed() -> Self {
        Self::bare(EvidenceKind::BarrierConsumed)
    }

    #[must_use]
    pub fn xi2_raw_confirm() -> Self {
        Self::bare(EvidenceKind::Xi2RawConfirm)
    }

    /// A value verb passes the state it requested as `intended`; a pointer or key verb's
    /// read-back of the hit element passes `None`.
    #[must_use]
    pub fn value_readback(
        intended: Option<String>,
        value: Option<String>,
        baseline: Option<String>,
    ) -> Self {
        let class = Self::derived_class(
            EvidenceKind::ValueReadback,
            intended.as_deref(),
            value.as_deref(),
        );
        Self {
            kind: EvidenceKind::ValueReadback,
            class,
            intended,
            value,
            baseline,
            event: None,
        }
    }

    #[must_use]
    pub fn focus_readback(value: Option<String>, baseline: Option<String>) -> Self {
        Self::read(EvidenceKind::FocusReadback, value, baseline)
    }

    #[must_use]
    pub fn menu_readback(value: Option<String>, baseline: Option<String>) -> Self {
        Self::read(EvidenceKind::MenuReadback, value, baseline)
    }

    /// `event` names the notification.
    #[must_use]
    pub fn ax_notification(event: String) -> Self {
        Self {
            event: Some(event),
            ..Self::bare(EvidenceKind::AxNotification)
        }
    }

    #[must_use]
    pub fn settle_frame_diff() -> Self {
        Self::bare(EvidenceKind::SettleFrameDiff)
    }

    #[must_use]
    pub fn ax_change() -> Self {
        Self::bare(EvidenceKind::AxChange)
    }

    #[must_use]
    pub const fn kind(&self) -> EvidenceKind {
        self.kind
    }

    #[must_use]
    pub const fn class(&self) -> EvidenceClass {
        self.class
    }

    #[must_use]
    pub fn intended(&self) -> Option<&str> {
        self.intended.as_deref()
    }

    #[must_use]
    pub fn value(&self) -> Option<&str> {
        self.value.as_deref()
    }

    #[must_use]
    pub fn baseline(&self) -> Option<&str> {
        self.baseline.as_deref()
    }

    #[must_use]
    pub fn event(&self) -> Option<&str> {
        self.event.as_deref()
    }

    #[must_use]
    pub fn is_receipt(&self) -> bool {
        self.class == EvidenceClass::Receipt
    }

    fn bare(kind: EvidenceKind) -> Self {
        Self {
            kind,
            class: Self::derived_class(kind, None, None),
            intended: None,
            value: None,
            baseline: None,
            event: None,
        }
    }

    fn read(kind: EvidenceKind, value: Option<String>, baseline: Option<String>) -> Self {
        Self {
            value,
            baseline,
            ..Self::bare(kind)
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireEvidence {
    kind: EvidenceKind,
    class: EvidenceClass,
    #[serde(default)]
    intended: Option<String>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    baseline: Option<String>,
    #[serde(default)]
    event: Option<String>,
}

impl TryFrom<WireEvidence> for Evidence {
    type Error = ReportRejection;

    fn try_from(wire: WireEvidence) -> Result<Self, Self::Error> {
        let derived =
            Self::derived_class(wire.kind, wire.intended.as_deref(), wire.value.as_deref());
        if wire.class != derived {
            return Err(ReportRejection::ClassMismatch {
                kind: wire.kind,
                tagged: wire.class,
                derived,
            });
        }
        if wire.intended.is_some() && wire.kind != EvidenceKind::ValueReadback {
            return Err(ReportRejection::IntendedOutsideValueReadback { kind: wire.kind });
        }
        if wire.event.is_some() != (wire.kind == EvidenceKind::AxNotification) {
            return Err(ReportRejection::EventMismatch { kind: wire.kind });
        }
        Ok(Self {
            kind: wire.kind,
            class: wire.class,
            intended: wire.intended,
            value: wire.value,
            baseline: wire.baseline,
            event: wire.event,
        })
    }
}

impl JsonSchema for Evidence {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("Evidence")
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        WireEvidence::json_schema(generator)
    }
}
