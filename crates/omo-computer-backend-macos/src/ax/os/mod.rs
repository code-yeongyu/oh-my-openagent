//! The live macOS AX server: `AXUIElement` calls with a per-IPC messaging timeout, elements
//! interned in a table (one id per element), the observer thread, and the private remote-token
//! pair behind its probe.

mod ffi;
mod observer;
mod process_query;
mod server;
mod token;
mod values;

pub use server::Server;
