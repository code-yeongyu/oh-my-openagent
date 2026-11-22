//! The result contract: `Disposition` (five delivery classes, seven valid pairs),
//! `ActionReport` with its `evidence[]`, and the by-verb receipt rule.

mod action;
mod derive;
mod disposition;
mod effect;
mod evidence;
mod rejection;
mod shape;
mod verb;

pub use action::{ActionReport, ReportParts};
pub use derive::{completed_effect, Settle};
pub use disposition::{Delivery, Disposition, InvalidDisposition, Retry};
pub use effect::{Delivered, Effect, FocusRestoration, Hit, Route, Timings};
pub use evidence::{Evidence, EvidenceClass, EvidenceKind};
pub use rejection::ReportRejection;
pub use verb::{Platform, ReportContext, VerbClass};

#[cfg(test)]
mod tests;
