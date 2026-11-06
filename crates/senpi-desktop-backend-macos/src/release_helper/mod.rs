//! Releases of held keys and buttons that outlive the engine (plan D7, #11466).
//!
//! Each input request's own cleanup releases what it presses, and the stop
//! worker's emergency release covers a stop, but both die with the engine. So
//! an input request that presses starts the engine binary again in its hidden
//! `--release-helper` mode (`guard`, `process`) and streams every press with
//! its release to it (`wire`). When the stream ends with presses still open,
//! the helper (`run`) posts their releases through the same routes (`plan`),
//! leaving the HID-route holds the user physically covers to the user (`tap`,
//! `holds`, `observe`).

pub(crate) mod guard;
mod holds;
mod observe;
mod plan;
mod poster;
mod process;
mod run;
mod signals;
mod tap;
pub(crate) mod wire;

#[cfg(test)]
mod guard_tests;
#[cfg(test)]
mod holds_tests;
#[cfg(test)]
mod plan_tests;
#[cfg(test)]
mod process_tests;
#[cfg(test)]
mod run_tests;
#[cfg(test)]
mod wire_tests;

pub(crate) use run::run;
