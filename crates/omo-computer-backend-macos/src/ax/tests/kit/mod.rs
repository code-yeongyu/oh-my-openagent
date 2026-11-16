//! A scripted AX server for the row 43 tests.

mod fake;
mod server;

pub use fake::{node, FakeAx, FakeToken, OnPoke};
