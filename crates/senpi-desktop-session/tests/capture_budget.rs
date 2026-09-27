//! The screenshot budget end to end: a session over the fake backend whose
//! capture returns an 8K noise frame, through `capture` to its wire result.

use std::sync::Arc;
use std::time::Duration;

use image::{Rgba, RgbaImage};
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::CaptureParams;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, DisplaySelector,
    Target,
};
use senpi_desktop_session::{BackendFactory, Op, Session, SessionTimeouts};
use serde_json::{json, Value};

/// Scenario `capture_size`: one 7680x4320 display.
const CAPTURE_SIZE: &str = r#"{
  "displays": [{"id": "1", "name": "8K", "x": 0, "y": 0, "width": 7680, "height": 4320, "scale": 1.0,
                "pixelX": 0, "pixelY": 0, "pixelWidth": 7680, "pixelHeight": 4320, "isPrimary": true}]
}"#;

/// Noise in 8x8 blocks: incompressible once capped, cheap to encode at 8K.
fn block_noise(width: u32, height: u32) -> RgbaImage {
    RgbaImage::from_fn(width, height, |x, y| {
        let block = u64::from(x / 8) << 32 | u64::from(y / 8) | 1;
        let mut state = block.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        state ^= state >> 29;
        state = state.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        state ^= state >> 32;
        let [r, g, b, ..] = state.to_le_bytes();
        Rgba([r, g, b, 255])
    })
}

/// The fake backend with every capture's pixels replaced by `noise`.
struct NoisyFake {
    fake: FakeBackend,
    noise: Arc<RgbaImage>,
}

impl Backend for NoisyFake {
    fn capabilities(&mut self) -> DesktopCapabilities {
        self.fake.capabilities()
    }
    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.fake.displays()
    }
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.fake.windows()
    }
    fn capture(&mut self, target: &Target, caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let (_, geometry) = self.fake.capture(target, caps)?;
        Ok(((*self.noise).clone(), geometry))
    }
    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        self.fake.pointer(target, ev, frame, mode)
    }
    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.fake.type_text(target, text, mode)
    }
    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.fake.key_chord(target, keys, mode)
    }
    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.fake.raise_window(id)
    }
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        self.fake.ax()
    }
}

struct NoisyFactory {
    scenario: FakeScenario,
    noise: Arc<RgbaImage>,
}

impl BackendFactory for NoisyFactory {
    fn create(&self, _selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
        Ok(Box::new(NoisyFake {
            fake: FakeBackend::new(self.scenario.clone()),
            noise: Arc::clone(&self.noise),
        }))
    }
}

/// An opened coordinate-safe session over scenario `capture_size`.
async fn open_capture_size(options: DesktopSessionOptions) -> Session {
    let factory = NoisyFactory {
        scenario: FakeScenario::from_json(CAPTURE_SIZE).expect("scenario parses"),
        noise: Arc::new(block_noise(7680, 4320)),
    };
    // Time is not under test: an unoptimized 8K resize can take tens of
    // seconds on a loaded machine, so the deadline only guards a hang.
    let timeouts = SessionTimeouts {
        operation: Duration::from_secs(600),
        ..SessionTimeouts::default()
    };
    let session = Session::start(factory, timeouts).expect("session starts");
    session.open(options).wait().await.expect("opens");
    session
}

async fn capture(session: &Session, caps: Option<CaptureCaps>) -> CoreResult<Value> {
    let params = CaptureParams {
        target: "desktop".to_owned(),
        caps,
    };
    let reply = session.submit(Op::Capture(params)).wait().await?;
    Ok(serde_json::to_value(reply).expect("capture serializes"))
}

fn inline_bytes(result: &Value) -> usize {
    let data = result["data"].as_str().expect("inline data");
    data.len() / 4 * 3 - data.bytes().rev().take_while(|byte| *byte == b'=').count()
}

fn with_bytes(max_bytes: u64) -> Option<CaptureCaps> {
    Some(CaptureCaps {
        max_bytes,
        ..CaptureCaps::default()
    })
}

#[tokio::test]
async fn capture_size_degrades_png_then_jpeg_then_artifact_as_max_bytes_shrinks() {
    // Given: a coordinate-safe session (5 MB default budget) over an 8K noise frame.
    let artifacts = tempfile::tempdir().expect("tempdir");
    let session = open_capture_size(DesktopSessionOptions {
        artifact_dir: Some(artifacts.path().to_path_buf()),
        capture_caps: CaptureCaps {
            coordinate_safe: true,
            ..CaptureCaps::default()
        },
        ..DesktopSessionOptions::default()
    })
    .await;
    // When: three captures under a shrinking byte budget.
    let mut results = Vec::new();
    for caps in [None, with_bytes(1_500_000), with_bytes(100_000)] {
        results.push(capture(&session, caps).await.expect("captures"));
    }
    // Then
    let modes: Vec<&Value> = results.iter().map(|result| &result["mode"]).collect();
    assert_eq!(
        modes,
        [
            &json!("inline-png"),
            &json!("inline-jpeg"),
            &json!("artifact-only")
        ]
    );
    for result in &results {
        let metadata = json!([
            result["width"],
            result["height"],
            result["sourceWidth"],
            result["sourceHeight"]
        ]);
        assert_eq!(metadata, json!([1280, 720, 7680, 4320]), "{}", result["mode"]);
    }
    assert!(
        inline_bytes(&results[0]) <= 5 * 1024 * 1024,
        "the default-budget PNG is within 5 MiB"
    );
    assert!(
        inline_bytes(&results[1]) <= 1_500_000,
        "the JPEG is within its budget"
    );
    let artifact = results[2]["artifactPath"].as_str().expect("artifact path");
    let saved = std::fs::metadata(artifact).expect("the artifact exists");
    assert!(saved.is_file() && saved.len() > 0);
    assert!(results[2]["data"].is_null() && results[2]["note"].is_string());
}

#[tokio::test]
async fn a_zero_byte_budget_fails_invalid_target_never_an_inline_result() {
    // Given
    let session = open_capture_size(DesktopSessionOptions::default()).await;
    // When
    let reply = capture(&session, with_bytes(0)).await;
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InvalidTarget));
}
