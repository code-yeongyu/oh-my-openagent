//! Wire validation of an `ActionReport`, run per (verb, report) pair. Without a context
//! only the rules that hold for every verb run; with one, the by-verb receipt rule and the
//! platform's receipt kinds run too.

use super::disposition::{Delivery, Disposition};
use super::effect::{Delivered, Effect};
use super::evidence::{Evidence, EvidenceClass, EvidenceKind};
use super::rejection::ReportRejection;
use super::verb::{ReportContext, VerbClass};

/// The members the rules read.
pub(super) struct Shape<'a> {
    pub disposition: Disposition,
    pub effect: Effect,
    pub delivered: Option<Delivered>,
    pub evidence: &'a [Evidence],
}

pub(super) fn check(
    shape: &Shape<'_>,
    context: Option<ReportContext>,
) -> Result<(), ReportRejection> {
    if let Some(context) = context {
        check_entries(shape.evidence, context)?;
    }
    check_counts(shape)?;
    check_effect(shape, context.map(|context| context.verb))
}

fn check_entries(evidence: &[Evidence], context: ReportContext) -> Result<(), ReportRejection> {
    for entry in evidence {
        if let Some(platform) = context.platform {
            if entry.is_receipt() && !platform.produces(entry.kind()) {
                return Err(ReportRejection::ReceiptOffPlatform {
                    kind: entry.kind(),
                    platform,
                });
            }
        }
        if context.verb == VerbClass::Action && entry.intended().is_some() {
            return Err(ReportRejection::IntendedOnActionVerb);
        }
    }
    Ok(())
}

fn check_counts(shape: &Shape<'_>) -> Result<(), ReportRejection> {
    match shape.delivered {
        Some(delivered) if delivered.count > delivered.of => {
            Err(ReportRejection::DeliveredCountExceedsTotal)
        }
        None if shape.effect == Effect::Partial => Err(ReportRejection::PartialWithoutDelivered),
        _ => Ok(()),
    }
}

fn check_effect(shape: &Shape<'_>, verb: Option<VerbClass>) -> Result<(), ReportRejection> {
    let delivery = shape.disposition.delivery();
    let receipts = || shape.evidence.iter().filter(|entry| entry.is_receipt());
    let confirms = |entry: &Evidence| match verb {
        Some(verb) => entry.kind() == verb.confirming_kind(),
        None => matches!(
            entry.kind(),
            EvidenceKind::BarrierConsumed | EvidenceKind::ValueReadback
        ),
    };
    let confirming = receipts().any(confirms);
    let observations = || {
        shape
            .evidence
            .iter()
            .filter(|entry| entry.class() == EvidenceClass::Observation)
    };
    if shape.effect != Effect::Confirmed
        && delivery == Delivery::DeliveredVerified
        && receipts().next().is_none()
    {
        return Err(ReportRejection::VerifiedWithoutReceipt);
    }
    match shape.effect {
        Effect::Confirmed => {
            if receipts().next().is_none() {
                return Err(ReportRejection::ConfirmedWithoutReceipt);
            }
            if !confirming {
                return Err(ReportRejection::ConfirmedWithoutConfirmingReceipt { verb });
            }
            if shape.disposition != Disposition::DELIVERED_VERIFIED {
                return Err(ReportRejection::ConfirmedNotVerified);
            }
            Ok(())
        }
        Effect::Refused if delivery != Delivery::NotDelivered => {
            Err(ReportRejection::RefusedButSent { delivery })
        }
        Effect::Observed | Effect::SuspectedNoop
            if !matches!(
                delivery,
                Delivery::DeliveredUnverified | Delivery::DeliveredVerified
            ) =>
        {
            Err(ReportRejection::NotDelivered {
                effect: shape.effect,
                delivery,
            })
        }
        Effect::Observed | Effect::Unverifiable | Effect::SuspectedNoop | Effect::NoChange
            if verb.is_some() && confirming =>
        {
            Err(ReportRejection::ConfirmingReceiptUnderOtherEffect {
                effect: shape.effect,
            })
        }
        Effect::Observed if !observations().any(|entry| entry.kind().reads_target()) => {
            Err(ReportRejection::ObservedWithoutObservation)
        }
        Effect::SuspectedNoop if observations().next().is_some() => {
            Err(ReportRejection::SuspectedNoopWithObservation)
        }
        _ => Ok(()),
    }
}
