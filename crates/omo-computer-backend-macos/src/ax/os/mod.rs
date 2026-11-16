//! The live macOS AX server: `AXUIElement` calls with a per-IPC messaging timeout, elements
//! retained in a table, the observer thread, and the private remote-token pair behind its probe.

mod ffi;
mod observer;
mod server;
mod token;
mod values;

pub use server::Server;
