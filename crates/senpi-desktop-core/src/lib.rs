//! Shared desktop wire types, errors, capture frames, keys, AX registry, and
//! the `Backend`/`AxBackend` traits every platform backend implements.

pub mod ax;
pub mod backend;
#[cfg(feature = "system-clipboard")]
pub mod clipboard;
pub mod error;
pub mod frame;
pub mod holds;
pub mod keys;
pub mod menus;
pub mod methods;
pub mod protocol;
mod protocol_holds;
pub mod protocol_params;
pub mod protocol_results;
pub mod protocol_schema;
pub mod types;

pub use protocol_schema::engine_schema;
