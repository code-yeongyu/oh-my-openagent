//! The `COMPUTER_*` table, keyed by `(engineCode, data.reason)`: one row for every engine
//! code of the closed table (its bare row, reason absent), one for every reason any stage,
//! gate, registry, preflight or backend default emits under that code, and one for every
//! failure raised outside the engine. Each row carries its disposition, whether anything
//! was sent, `retryable`, the recovery and the `nextCall`.

use super::code::{ComputerCode, EngineCode};
use super::reason::{LayerFailure, Reason};
pub(super) use super::row::NextCall;
use super::row::{DispositionRule, ErrorRow, FailureKey, NothingSent, Recovery, Source};
use crate::report::Disposition;

const NDS: DispositionRule = DispositionRule::Fixed(Disposition::NOT_DELIVERED_SAFE);
const NDAU: DispositionRule = DispositionRule::Fixed(Disposition::NOT_DELIVERED_AFTER_USER);
const DUU: DispositionRule = DispositionRule::Fixed(Disposition::UNCERTAIN_UNSAFE);
const DVU: DispositionRule = DispositionRule::Fixed(Disposition::DELIVERED_UNVERIFIED);
const UNK: DispositionRule = DispositionRule::Fixed(Disposition::UNKNOWN);
/// Nothing sent: retry after a fresh read; part sent: never resend.
const MIDSEND: DispositionRule = DispositionRule::BySent {
    nothing: Disposition::NOT_DELIVERED_SAFE,
    some: Disposition::UNCERTAIN_UNSAFE,
};
/// Nothing sent: the user decides; a prefix landed: never resend it.
const PREFIX: DispositionRule = DispositionRule::BySent {
    nothing: Disposition::NOT_DELIVERED_AFTER_USER,
    some: Disposition::DELIVERED_UNVERIFIED,
};
const INNER: DispositionRule = DispositionRule::OfInnerCode;
const RUN: DispositionRule = DispositionRule::LastReport;

/// Where the design says nothing follows: its code table's `nextCall` column reads `-`.
const NOTHING_FOLLOWS: &str =
    "design/d-sdk-skill.md '## Errors and retry hints', nextCall column: -";

const ASK: Option<Recovery> = Some(Recovery::AskUser);
const INSPECT: Option<Recovery> = Some(Recovery::InspectStateThenRetry);
const REFRESH: Option<Recovery> = Some(Recovery::RefreshSnapshotThenRetry);

const fn make(
    source: Source,
    reason: Option<Reason>,
    computer: ComputerCode,
    rule: DispositionRule,
    nothing_sent: NothingSent,
    recovery: Option<Recovery>,
    next_call: NextCall,
) -> ErrorRow {
    ErrorRow {
        key: FailureKey { source, reason },
        computer,
        disposition: rule,
        nothing_sent,
        retryable: rule.retryable(),
        recovery,
        next_call,
    }
}

/// `e!(EngineCode, Reason|_ => ComputerCode, rule, Yes|No|Depends, recovery, "call" | none | nothing "cite")`: the last slot is mandatory; `none` is the design's `-`.
macro_rules! e {
    ($code:ident, $($reason:ident)? $(_)? => $computer:ident, $rule:expr, $sent:ident, $recovery:expr, $($next:tt)+) => {
        make(
            Source::Engine(EngineCode::$code),
            e!(@reason $($reason)?),
            ComputerCode::$computer,
            $rule,
            NothingSent::$sent,
            $recovery,
            e!(@next $($next)+),
        )
    };
    (@reason) => { None };
    (@reason $reason:ident) => { Some(Reason::$reason) };
    // The next-call slot is mandatory: exactly one of "call", `none` (the design's `-`) or
    // `nothing "cite"`. There is no empty arm, so a row without the slot does not build.
    (@next $next:literal) => { NextCall::Call($next) };
    (@next none) => { NextCall::Nothing { cite: NOTHING_FOLLOWS } };
    (@next nothing $cite:literal) => { NextCall::Nothing { cite: $cite } };
}

/// `l!(LayerFailure, Reason|_ => ComputerCode, rule, Yes|No|Depends, recovery, "call" | none | nothing "cite")`: the last slot is mandatory; `none` is the design's `-`.
macro_rules! l {
    ($layer:ident, $($reason:ident)? $(_)? => $computer:ident, $rule:expr, $sent:ident, $recovery:expr, $($next:tt)+) => {
        make(
            Source::Layer(LayerFailure::$layer),
            e!(@reason $($reason)?),
            ComputerCode::$computer,
            $rule,
            NothingSent::$sent,
            $recovery,
            e!(@next $($next)+),
        )
    };
}

mod control;
mod input;
mod layer;
mod session;

/// Every row, engine codes first.
pub(super) fn rows() -> impl Iterator<Item = &'static ErrorRow> {
    input::ROWS
        .iter()
        .chain(session::ROWS)
        .chain(control::ROWS)
        .chain(layer::ROWS)
}
