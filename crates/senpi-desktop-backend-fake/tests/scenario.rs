mod common;

use std::time::{Duration, Instant};

use senpi_desktop_backend_fake::{DelayMs, FakeBackend, FakeClock, FakeMethod, FakeScenario, ScenarioError};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::ErrorCode;

#[test]
fn fixture_serves_one_focused_window() {
    // Given: the two-displays-one-window fixture
    let mut backend = common::fixture_backend();
    // When
    let windows = backend.windows().expect("windows");
    // Then
    assert_eq!(windows.len(), 1);
    assert!(windows[0].focused);
}

#[test]
fn fixture_capabilities_count_the_scripted_displays() {
    let mut backend = common::fixture_backend();
    let caps = backend.capabilities();
    assert_eq!(caps.backend, "fake");
    assert_eq!(caps.display_count, 2);
}

#[test]
fn capability_overlay_overrides_only_the_named_fields() {
    let scenario = FakeScenario::from_json(r#"{"capabilities":{"capture":false,"displayCount":7}}"#)
        .expect("scenario parses");
    assert!(!scenario.capabilities.capture);
    assert_eq!(scenario.capabilities.display_count, 7);
    assert!(scenario.capabilities.input);
}

#[test]
fn unknown_capability_field_is_rejected() {
    let err = FakeScenario::from_json(r#"{"capabilities":{"captur":false}}"#).expect_err("typo rejected");
    assert!(matches!(err, ScenarioError::Parse(_)), "{err}");
    assert!(err.to_string().contains("captur"), "{err}");
}

#[test]
fn ax_tree_for_an_unscripted_window_is_rejected() {
    let err = FakeScenario::from_json(r#"{"ax":{"9":{"role":"window"}}}"#).expect_err("unknown window");
    assert!(err.to_string().contains("unknown window '9'"), "{err}");
}

#[test]
fn unknown_top_level_key_is_rejected() {
    let err = FakeScenario::from_json(r#"{"delay":5}"#).expect_err("typo rejected");
    assert!(err.to_string().contains("delay"), "{err}");
}

#[test]
fn scripted_failures_are_queued_at_load() {
    let scenario = FakeScenario::from_json(r#"{"fail_next":[{"method":"displays","code":"Timeout"}]}"#)
        .expect("scenario parses");
    let mut backend = FakeBackend::new(scenario);
    let err = backend.displays().expect_err("scripted failure");
    assert_eq!(err.code, ErrorCode::Timeout);
    assert!(backend.displays().is_ok());
}

#[test]
fn scalar_delay_applies_to_every_method() {
    let scenario = FakeScenario::from_json(r#"{"delay_ms":5000}"#).expect("scenario parses");
    assert_eq!(scenario.delay_ms, DelayMs::Every(5000));
    assert_eq!(
        scenario.delay_ms.for_method(FakeMethod::Capture),
        Some(Duration::from_secs(5))
    );
    assert_eq!(
        scenario.delay_ms.for_method(FakeMethod::AxProps),
        Some(Duration::from_secs(5))
    );
}

#[test]
fn per_method_delay_applies_only_to_its_method() {
    let scenario = FakeScenario::from_json(r#"{"delay_ms":{"capture":5000}}"#).expect("scenario parses");
    assert_eq!(
        scenario.delay_ms.for_method(FakeMethod::Capture),
        Some(Duration::from_secs(5))
    );
    assert_eq!(scenario.delay_ms.for_method(FakeMethod::Windows), None);
}

#[test]
fn delayed_method_blocks_for_at_least_its_delay() {
    // Time is the behavior under test: the engine's timeout tests rely on it.
    let scenario = FakeScenario::from_json(r#"{"delay_ms":{"displays":25}}"#).expect("scenario parses");
    let mut backend = FakeBackend::new(scenario);
    let started = Instant::now();
    backend.displays().expect("displays");
    assert!(started.elapsed() >= Duration::from_millis(25));
}

#[test]
fn fake_clock_clones_share_one_time() {
    let clock = FakeClock::new(1_000);
    let observer = clock.clone();
    assert_eq!(clock.advance(2_001), 3_001);
    assert_eq!(observer.now_ms(), 3_001);
    observer.set(10);
    assert_eq!(clock.now_ms(), 10);
}

#[test]
fn fake_clock_saturates_instead_of_wrapping() {
    let clock = FakeClock::new(u64::MAX - 1);
    assert_eq!(clock.advance(5), u64::MAX);
}
