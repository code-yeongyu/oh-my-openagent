//! `observe`, `drill` and `find` over the fake's fixtures and the scripted tree.

mod diff;
mod gates;
mod skeleton;
mod tokens;

use omo_computer_backend_fake::{fixtures_dir, FakeBackend, FakeScenario};
use omo_computer_core::ax::AxReader;
use omo_computer_core::observation::Observation;
use omo_computer_core::params::ObserveParams;
use serde_json::Value;

use super::{observe, Request};
use crate::refs::RefRegistry;

fn fixture(name: &str) -> FakeBackend {
    FakeBackend::new(FakeScenario::load(&fixtures_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}")))
}

/// The request the wire params read into.
fn request(params: Value) -> Request {
    Request::read(serde_json::from_value::<ObserveParams>(params).expect("observe params"))
}

fn run(refs: &mut RefRegistry, reader: &mut dyn AxReader, params: Value) -> Observation {
    observe(refs, reader, &request(params)).expect("observe")
}

/// The outline lines of a tree or diff text, without the trailer.
fn lines(text: &str) -> Vec<&str> {
    text.lines().filter(|line| !line.starts_with('…')).collect()
}
