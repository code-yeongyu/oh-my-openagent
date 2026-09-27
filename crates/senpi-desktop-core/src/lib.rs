//! Shared desktop wire types, errors, capture frames, keys, AX registry, and
//! the `Backend`/`AxBackend` traits every platform backend implements.

pub mod ax;
pub mod backend;
pub mod error;
pub mod frame;
pub mod keys;
pub mod methods;
pub mod protocol;
pub mod protocol_params;
pub mod protocol_results;
pub mod protocol_schema;
pub mod types;

pub use protocol_schema::engine_schema;
