//! How a refusal reaches the wire: the closed code's number and name, `data.code`/`data.reason`,
//! and a funnel refusal's call members, stamps and detail (moved from rpc.rs, R65: no change).

use omo_computer_core::backend::Refusal;
use omo_computer_session::grant::HostCallError;
use omo_computer_session::{Refused, Unresolved};
use serde_json::{json, Value};

use super::{failure, Failure, INVALID_PARAMS};

pub(super) fn host_failure(error: HostCallError) -> Failure {
    match error {
        HostCallError::Params(error) => {
            failure(INVALID_PARAMS, "Invalid params", Some(json!({ "detail": error.to_string() })))
        }
        HostCallError::Refused(refused) => refused_call(&refused),
    }
}

/// A refusal on the wire: the closed engine code's number and name, `data.code` as v1 wrote
/// it, and `data.reason` when the refusal carries one. Every refusal resolves to its row of
/// the one error table (a bare refusal to its code's bare row); a pair with no row is a
/// backend defect, reported on stderr, and still answered with the refusal's own code.
pub(super) fn refused(refusal: &Refusal) -> Failure {
    if let Err(unknown) = refusal.row() {
        eprintln!("omo-computer-engine: {unknown}");
    }
    let mut data = json!({ "code": refusal.code.wire(), "hint": null });
    if let Some(reason) = refusal.reason {
        data["reason"] = json!(reason);
    }
    failure(refusal.code.number(), refusal.code.wire(), Some(data))
}

/// R60c: a refusal whose row reads its disposition from the inner stage (a gated drag point)
/// carries that stage pair's disposition and next call, looked up in the same table.
fn inner_disposition(refusal: &Refusal, detail: Option<&Value>, data: &mut Value) {
    let inner = refusal.row().is_ok_and(|row| row.disposition == omo_computer_core::error::DispositionRule::OfInnerCode);
    let Some(stage) = detail.filter(|_| inner).and_then(|d| d.get("stageCode")).and_then(Value::as_str) else {
        return;
    };
    let reason = detail.and_then(|d| d.get("stageReason")).and_then(Value::as_str);
    let Ok(row) = omo_computer_core::error::inner_row(stage, reason) else {
        return;
    };
    let disposition = match row.disposition {
        omo_computer_core::error::DispositionRule::Fixed(d) | omo_computer_core::error::DispositionRule::BySent { nothing: d, .. } => d,
        _ => return,
    };
    data["disposition"] = json!(disposition);
    if let omo_computer_core::error::NextCall::Call(call) = row.next_call {
        data["nextCall"] = json!(call);
    }
}

/// A funnel refusal: the refusal's members plus the `callId` it concerns, for a replay the
/// stored `receipt` (`TransactionFailed{reason:"replayed", callId, receipt}`), and for a call
/// whose send was interrupted its `disposition` (`delivery_uncertain/unsafe`): without it
/// the code's own row would read `not_delivered/safe` and invite a resend; `warning:"write_failed"`
/// when the refusal's own audit line could not be written.
pub(super) fn refused_call(refused: &Refused) -> Failure {
    let mut failure = self::refused(&refused.refusal);
    if let Some(data) = failure.data.as_mut() {
        if let Some(call_id) = &refused.call_id {
            data["callId"] = json!(call_id);
        }
        if let Some(receipt) = &refused.receipt {
            data["receipt"] = (**receipt).clone();
        }
        if let Some(disposition) = refused.interrupted {
            data["disposition"] = json!(disposition);
        }
        let stamps = &refused.stamps;
        if let Some(delivered) = stamps.delivered {
            data["delivered"] = json!({ "count": delivered.count, "of": delivered.of });
        }
        if !stamps.paused.is_empty() {
            data["paused"] = json!(stamps.paused);
        }
        if let Some(session) = &stamps.session {
            data["session"] = json!(session);
        }
        if let Some(target) = stamps.target {
            data["target"] = json!(target);
        }
        inner_disposition(&refused.refusal, refused.detail.as_deref(), data);
        if let (Some(Value::Object(detail)), Some(data)) = (refused.detail.as_deref(), data.as_object_mut()) {
            for (key, value) in detail {
                data.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        if let Some(warning) = &refused.warning {
            data["warning"] = json!(warning);
        }
    }
    failure
}

/// A ref that did not resolve: the refusal, and on `AmbiguousTarget` the `candidates`.
pub(super) fn unresolved(unresolved: &Unresolved) -> Failure {
    let mut failure = refused(&unresolved.refusal);
    if let Some(data) = failure.data.as_mut().filter(|_| !unresolved.candidates.is_empty()) {
        data["candidates"] = json!(unresolved.candidates);
    }
    failure
}
