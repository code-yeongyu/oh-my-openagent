use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::{DesktopSessionOptions, MacosCanaryMode};
use senpi_desktop_session::{BackendFactory, Session, SessionTimeouts};

struct RecordingFactory {
    options: Arc<Mutex<Vec<DesktopSessionOptions>>>,
}

impl BackendFactory for RecordingFactory {
    fn create(&self, options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        self.options.lock().push(options.clone());
        let scenario = FakeScenario::from_json(include_str!(
            "../../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
        ))
        .expect("fixture parses");
        Ok(Box::new(FakeBackend::new(scenario)))
    }
}

#[tokio::test]
async fn session_reconfiguration_passes_the_selected_canary_policy_to_each_backend() {
    // Given: an actual session thread whose backend factory records its configuration.
    let options = Arc::new(Mutex::new(Vec::new()));
    let session = Session::start(
        RecordingFactory {
            options: Arc::clone(&options),
        },
        SessionTimeouts::default(),
    )
    .expect("session starts");
    let disabled = DesktopSessionOptions {
        display: Some("1".to_owned()),
        macos_canary: MacosCanaryMode::Off,
        ..DesktopSessionOptions::default()
    };
    let enabled = DesktopSessionOptions {
        display: Some("all".to_owned()),
        ..DesktopSessionOptions::default()
    };

    // When: a session is opened with off, then reconfigured to the default policy.
    session.open(disabled.clone()).wait().await.expect("opens");
    session.open(enabled.clone()).wait().await.expect("reopens");
    session.close().wait().await.expect("closes");

    // Then: the startup probe never enables the GUI helper; real opens keep their preferences.
    assert_eq!(
        *options.lock(),
        vec![DesktopSessionOptions { show_cursor: false, ..DesktopSessionOptions::default() }, disabled, enabled]
    );
}

#[tokio::test]
async fn cursor_only_reconfiguration_does_not_recreate_the_backend() {
    // Given: one opened session and its factory creation ledger.
    let options = Arc::new(Mutex::new(Vec::new()));
    let session = Session::start(
        RecordingFactory {
            options: Arc::clone(&options),
        },
        SessionTimeouts::default(),
    )
    .expect("session starts");
    let shown = DesktopSessionOptions::default();
    let hidden = DesktopSessionOptions {
        show_cursor: false,
        ..shown.clone()
    };
    session.open(shown.clone()).wait().await.expect("opens");

    // When: only the display-only cursor preference changes.
    session.open(hidden).wait().await.expect("reconfigures");
    session.close().wait().await.expect("closes");

    // Then: only the probe and initial open created backends.
    assert_eq!(*options.lock(), vec![DesktopSessionOptions { show_cursor: false, ..DesktopSessionOptions::default() }, shown]);
}
