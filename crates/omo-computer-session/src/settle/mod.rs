//! The one settle primitive (design row C5): a quiet window fed only by the backend's observer
//! events, bounded by a deadline on the backend's monotonic clock, answering `settled`,
//! `pending` or `unsupported`; the loading-indicator wait in front of it (amendment A4); and the
//! stages the observe and the mutate funnel run. Every duration comes from `SETTLE_PROFILE`;
//! nothing here sleeps, and quiet is never reported as completion.

mod busy;
mod feed;
mod kinds;
mod predicate;
mod quiet;
mod stages;

#[cfg(test)]
mod tests;

pub use busy::{wait_clear, Busy};
pub(crate) use feed::feed;
pub use feed::Feed;
pub use kinds::{event_kind, is_navigation, window_state};
pub use predicate::EventMatch;
pub use quiet::{quiet_window, Bounds, Picking, Settled};
pub(crate) use stages::SettleState;
pub use stages::{BusyDetail, TARGET_BUSY};
