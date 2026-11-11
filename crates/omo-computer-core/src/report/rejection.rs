//! Why wire validation refuses an `ActionReport` shape. Every refusal is a typed value:
//! nothing in the result contract throws or matches on text.

use std::fmt;

use super::disposition::Delivery;
use super::effect::Effect;
use super::evidence::{EvidenceClass, EvidenceKind};
use super::verb::{Platform, VerbClass};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportRejection {
    /// An entry's tagged class differs from the class its kind and values derive.
    ClassMismatch {
        kind: EvidenceKind,
        tagged: EvidenceClass,
        derived: EvidenceClass,
    },
    /// `intended` on an entry other than `value_readback`.
    IntendedOutsideValueReadback { kind: EvidenceKind },
    /// `event` missing on `ax_notification`, or present on another kind.
    EventMismatch { kind: EvidenceKind },
    /// A receipt kind this platform cannot produce.
    ReceiptOffPlatform {
        kind: EvidenceKind,
        platform: Platform,
    },
    /// A value read-back carrying `intended` on a pointer or key verb, which requests no value.
    IntendedOnActionVerb,
    /// `confirmed` with no receipt-class entry at all.
    ConfirmedWithoutReceipt,
    /// `confirmed` whose receipts do not include a kind that confirms this verb (any verb
    /// when the verb is not known): an `xi2_raw_confirm` alone confirms nothing.
    ConfirmedWithoutConfirmingReceipt { verb: Option<VerbClass> },
    /// `confirmed` whose disposition is not `delivered_verified/unsafe`.
    ConfirmedNotVerified,
    /// A receipt that confirms this verb on a report whose effect is not `confirmed`.
    ConfirmingReceiptUnderOtherEffect { effect: Effect },
    /// `observed` with no entry that read the target after the send.
    ObservedWithoutObservation,
    /// `suspected_noop` with an observation entry.
    SuspectedNoopWithObservation,
    /// `observed` or `suspected_noop` whose delivery is not a delivered class.
    NotDelivered { effect: Effect, delivery: Delivery },
    /// `delivered_verified` with no receipt-class entry.
    VerifiedWithoutReceipt,
    /// `partial` without `delivered{count, of}`.
    PartialWithoutDelivered,
    /// `refused` whose delivery is not `not_delivered`.
    RefusedButSent { delivery: Delivery },
    /// `delivered.count` greater than `delivered.of`.
    DeliveredCountExceedsTotal,
}

impl fmt::Display for ReportRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid ActionReport shape: {self:?}")
    }
}

impl std::error::Error for ReportRejection {}
