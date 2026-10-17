//! macOS peer identity foundation. Eligibility is not a user operation grant.
//!
//! Resolved policy inputs and verified-peer constructors are private. Production
//! callers obtain peers only through the sealed Security.framework verifier.
#[cfg(target_os = "macos")]
mod policy;
#[cfg(target_os = "macos")]
mod connection;
#[cfg(target_os = "macos")]
mod capability;
#[cfg(target_os = "macos")]
mod listener;
#[cfg(target_os = "macos")]
mod native;
#[cfg(target_os = "macos")]
mod dictionary;
#[cfg(target_os = "macos")]
mod agent;
#[cfg(target_os = "macos")]
mod peers;
#[cfg(target_os = "macos")]
mod stream;
#[cfg(target_os = "macos")]
pub use agent::AgentTransport;
#[cfg(target_os = "macos")]
pub use stream::{Incoming, forward_frames};
#[cfg(target_os = "macos")]
pub use connection::TransportError;
pub mod roles;

#[cfg(target_os = "macos")]
mod audit;
#[cfg(target_os = "macos")]
pub mod identity;
#[cfg(target_os = "macos")]
mod security;
#[cfg(target_os = "macos")]
mod signing_info;

#[cfg(target_os = "macos")]
pub use policy::{RejectReason, SecurityOperation, VerifiedPeer};

#[cfg(all(test, target_os = "macos"))]
mod transport_tests;

#[cfg(all(test, target_os = "macos"))]
mod crash_tests;
