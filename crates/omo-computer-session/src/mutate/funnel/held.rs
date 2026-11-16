//! What the admission hands the send stages (moved out of funnel/mod.rs to keep it under the
//! 250-line cap, R65a).

/// Row 22's admission outcome and per-call settings, and row 21's audit binding, carried into
/// the send stages.
pub(super) struct Held {
    pub(super) admission: crate::intervention::Admission,
    pub(super) policy: omo_computer_core::settings::Intervention,
    pub(super) object: bool,
    pub(super) hold_limits: crate::intervention::HoldLimits,
    pub(super) target: Option<String>,
    pub(super) binding: Option<(bool, Option<Vec<u8>>)>,
}
