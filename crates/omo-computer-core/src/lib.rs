//! Contract root of the computer-use v3 module: method table, results, receipts, frames, refs, traits and tables.

pub mod ax;
pub mod apps;
pub mod backend;
pub mod capabilities;
pub mod doc;
pub mod env;
pub mod error;
pub mod frame;
pub mod hello;
pub mod listing;
pub mod menus;
pub mod methods;
mod nullable;
pub mod observation;
pub mod params;
pub mod paths;
pub mod report;
pub mod requests;
pub mod results;
pub mod schema;
pub mod session_state;
pub mod settings;
pub mod surface;
pub mod untrusted;
pub mod url_policy;

#[cfg(test)]
mod protocol_test;
