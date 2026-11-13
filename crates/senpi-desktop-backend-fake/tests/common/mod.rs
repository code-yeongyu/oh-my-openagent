use std::path::Path;

use senpi_desktop_backend_fake::{FakeBackend, FakeScenario};

pub const TWO_DISPLAYS_ONE_WINDOW: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/fixtures/two-displays-one-window.json"
);

pub fn fixture_scenario() -> FakeScenario {
    FakeScenario::load(Path::new(TWO_DISPLAYS_ONE_WINDOW)).expect("fixture parses")
}

pub fn fixture_backend() -> FakeBackend {
    FakeBackend::new(fixture_scenario())
}
