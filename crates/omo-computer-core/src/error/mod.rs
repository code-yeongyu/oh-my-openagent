//! The one error contract: the `COMPUTER_*` table keyed by `(engineCode, data.reason)`,
//! total over the closed 33-code engine table, every reason any stage emits, and every
//! failure raised outside the engine. A failure is a typed value from end to end: a wire
//! number or reason token is parsed once into the closed sets, and an unknown one is a
//! typed `UnknownFailure`.

macro_rules! closed_names {
    ($(#[$doc:meta])* $name:ident [$count:literal] { $($variant:ident = $wire:literal,)+ }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $name { $($variant,)+ }

        impl $name {
            /// Every member, in declaration order.
            pub const ALL: [Self; $count] = [$(Self::$variant,)+];

            /// The wire spelling.
            #[must_use]
            pub const fn wire(self) -> &'static str {
                match self { $(Self::$variant => $wire,)+ }
            }

            /// The member spelled `wire`, if any.
            #[must_use]
            pub fn from_wire(wire: &str) -> Option<Self> {
                Self::ALL.into_iter().find(|member| member.wire() == wire)
            }
        }
    };
}

mod code;
mod reason;
mod row;
mod table;

pub use code::{ComputerCode, EngineCode, ENGINE_CODE_BASE};
pub use reason::{LayerFailure, Reason};
pub use row::{
    from_wire, lookup, DispositionRule, ErrorRow, FailureKey, NextCall, NothingSent, Recovery,
    Source, UnknownFailure,
};

/// Every row of the table.
pub fn rows() -> impl Iterator<Item = &'static ErrorRow> {
    table::rows()
}

#[cfg(test)]
mod tests;
