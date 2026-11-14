//! Refusals built from the closed reason set, so every pair the crate emits is a typed
//! `(EngineCode, Reason)` that resolves through the one error table.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The refusal `code{reason}`; the one place a `Reason` becomes the refusal's reason.
#[must_use]
pub(crate) const fn reasoned(code: EngineCode, reason: Reason) -> Refusal {
    Refusal::new(code, reason.wire())
}

/// One closed refusal set: `Variant => Code(Reason)` or `Variant => Code` (the bare row).
/// `ALL` lists every member so a test can resolve each pair through the table.
macro_rules! verdicts {
    (
        $(#[$doc:meta])*
        $name:ident [$count:literal] {
            $($(#[$vdoc:meta])* $variant:ident => $code:ident $(($reason:ident))?,)+
        }
    ) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($(#[$vdoc])* $variant,)+
        }

        impl $name {
            /// Every member, in declaration order.
            pub const ALL: [Self; $count] = [$(Self::$variant,)+];

            /// The refusal this verdict answers, nothing sent.
            #[must_use]
            pub const fn refusal(self) -> omo_computer_core::backend::Refusal {
                match self {
                    $(Self::$variant => verdicts!(@refusal $code $($reason)?),)+
                }
            }
        }
    };
    (@refusal $code:ident) => {
        omo_computer_core::backend::Refusal::bare(omo_computer_core::error::EngineCode::$code)
    };
    (@refusal $code:ident $reason:ident) => {
        $crate::refusal::reasoned(
            omo_computer_core::error::EngineCode::$code,
            omo_computer_core::error::Reason::$reason,
        )
    };
}
