//! The `COMPUTER_*` table, keyed by `(engineCode, data.reason)`: one row for every engine
//! code of the closed table (its bare row, reason absent), one for every reason any stage,
//! gate, registry, preflight or backend default emits under that code, and one for every
//! failure raised outside the engine. Each row carries its disposition, whether anything
//! was sent, `retryable`, the recovery and the `nextCall`.

use super::code::{ComputerCode, EngineCode};
use super::reason::{LayerFailure, Reason};
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
    next_call: Option<&'static str>,
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

/// `e!(EngineCode, Reason|_ => ComputerCode, rule, Yes|No|Depends, recovery, nextCall|_)`.
macro_rules! e {
    ($code:ident, $($reason:ident)? $(_)? => $computer:ident, $rule:expr, $sent:ident, $recovery:expr, $($next:literal)? $(_)?) => {
        make(
            Source::Engine(EngineCode::$code),
            e!(@reason $($reason)?),
            ComputerCode::$computer,
            $rule,
            NothingSent::$sent,
            $recovery,
            e!(@next $($next)?),
        )
    };
    (@reason) => { None };
    (@reason $reason:ident) => { Some(Reason::$reason) };
    (@next) => { None };
    (@next $next:literal) => { Some($next) };
}

/// `l!(LayerFailure, Reason|_ => ComputerCode, rule, Yes|No|Depends, recovery, nextCall|_)`.
macro_rules! l {
    ($layer:ident, $($reason:ident)? $(_)? => $computer:ident, $rule:expr, $sent:ident, $recovery:expr, $($next:literal)? $(_)?) => {
        make(
            Source::Layer(LayerFailure::$layer),
            e!(@reason $($reason)?),
            ComputerCode::$computer,
            $rule,
            NothingSent::$sent,
            $recovery,
            e!(@next $($next)?),
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
