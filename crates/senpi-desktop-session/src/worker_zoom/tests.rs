mod backend;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{CaptureParams, CaptureRegionParams};
use senpi_desktop_core::types::{CaptureCaps, CaptureRegion, CaptureResult, Target};

use crate::request::{Op, Response};
use crate::worker::Worker;
use backend::setup;

fn full(worker: &mut Worker, target: &str) -> CaptureResult {
    let response = worker
        .process(
            Op::Capture(CaptureParams {
                target: target.into(),
                caps: Some(CaptureCaps {
                    max_width: Some(32),
                    ..CaptureCaps::default()
                }),
                exclude_window_titles: None,
            }),
            &|| false,
        )
        .unwrap();
    let Response::Capture(capture) = response else {
        panic!("expected capture")
    };
    capture
}

fn params(target: &str) -> CaptureRegionParams {
    CaptureRegionParams {
        target: target.into(),
        region: CaptureRegion {
            x: 8.0,
            y: 6.0,
            width: 8.0,
            height: 6.0,
        },
        caps: Some(CaptureCaps {
            max_width: Some(8),
            ..CaptureCaps::default()
        }),
        frame_id: None,
    }
}

fn zoom(worker: &mut Worker, params: CaptureRegionParams) -> CaptureResult {
    let response = worker
        .process(Op::CaptureRegion(params), &|| false)
        .unwrap();
    let Response::Capture(capture) = response else {
        panic!("expected zoom")
    };
    capture
}

#[test]
fn zoom_uses_fresh_native_pixels_and_preserves_the_full_click_frame() {
    // Given
    let (mut worker, state) = setup();
    let full = full(&mut worker, "101");
    let target = Target::parse("101");
    let base = worker.frames.latest(&target, Some(&full.frame_id)).unwrap();
    // When
    let shot = zoom(&mut worker, params("101"));
    // Then
    assert_eq!(
        state.lock().captures.len(),
        2,
        "zoom must capture fresh native pixels"
    );
    assert_eq!(
        (shot.source_width, shot.source_height),
        (32, 24),
        "zoom must capture native crop dimensions"
    );
    assert_eq!((shot.width, shot.height), (8, 6));
    assert_eq!((shot.coordinate_width, shot.coordinate_height), (32, 24));
    assert_eq!(shot.region, Some(params("101").region));
    assert_eq!(
        shot.frame_id, full.frame_id,
        "zoom must preserve full frame id"
    );
    assert_eq!(
        worker.frames.latest(&target, Some(&full.frame_id)).unwrap(),
        base
    );
    assert_eq!(
        base.map_point(16.0, 12.0, Some(&state.lock().window))
            .unwrap(),
        (32.0, 24.0)
    );
    let png = decode_base64(shot.data.as_deref().unwrap());
    let image = image::load_from_memory(&png).unwrap().to_rgba8();
    assert_eq!(
        image.get_pixel(0, 0).0,
        [2, 0, 0, 255],
        "old screenshot pixels must not be reused"
    );
}

#[test]
fn zoom_rejects_missing_invalid_and_stale_frames_before_capture() {
    // Given
    let (mut worker, state) = setup();
    // When
    let missing = worker
        .process(Op::CaptureRegion(params("101")), &|| false)
        .unwrap_err();
    // Then
    assert_eq!(missing.code, ErrorCode::InvalidCoordinateFrame);
    assert!(state.lock().captures.is_empty());
    full(&mut worker, "101");
    for region in [
        CaptureRegion {
            x: f64::NAN,
            ..params("101").region
        },
        CaptureRegion {
            x: -1.0,
            ..params("101").region
        },
        CaptureRegion {
            width: 0.0,
            ..params("101").region
        },
        CaptureRegion {
            width: f64::INFINITY,
            ..params("101").region
        },
        CaptureRegion {
            x: 32.0,
            ..params("101").region
        },
    ] {
        let request = CaptureRegionParams {
            region,
            ..params("101")
        };
        assert_eq!(
            worker
                .process(Op::CaptureRegion(request), &|| false)
                .unwrap_err()
                .code,
            ErrorCode::InvalidCoordinateFrame
        );
    }
    let request = CaptureRegionParams {
        frame_id: Some("stale".into()),
        ..params("101")
    };
    assert_eq!(
        worker
            .process(Op::CaptureRegion(request), &|| false)
            .unwrap_err()
            .code,
        ErrorCode::InvalidCoordinateFrame
    );
    state.lock().window.width = 65;
    assert_eq!(
        worker
            .process(Op::CaptureRegion(params("101")), &|| false)
            .unwrap_err()
            .code,
        ErrorCode::InvalidCoordinateFrame
    );
    assert_eq!(state.lock().captures.len(), 1);
}

#[test]
fn desktop_zoom_pins_captured_display_after_active_focus_changes() {
    // Given
    let (mut worker, state) = setup();
    let full = full(&mut worker, "desktop");
    state.lock().active = "2".into();
    // When
    let shot = zoom(&mut worker, params("desktop"));
    // Then
    assert_eq!(
        state.lock().captures,
        [Target::Desktop, Target::parse("display:1")]
    );
    assert_eq!(shot.frame_id, full.frame_id);
    let frame = worker
        .frames
        .latest(&Target::Desktop, Some(&full.frame_id))
        .unwrap();
    assert_eq!(frame.map_point(16.0, 12.0, None).unwrap(), (32.0, 24.0));
}

#[test]
fn zoom_rejects_changed_display_layout_before_capture() {
    // Given
    let (mut worker, state) = setup();
    let full = full(&mut worker, "desktop");
    state.lock().displays[0].scale = 3.0;
    // When
    let error = worker
        .process(Op::CaptureRegion(params("desktop")), &|| false)
        .unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(state.lock().captures.len(), 1);
    assert_eq!(
        worker.frames.latest_id("desktop"),
        Some(full.frame_id.as_str())
    );
}

#[test]
fn zoom_error_and_cancel_leave_the_input_frame_intact() {
    // Given
    let (mut worker, state) = setup();
    let full = full(&mut worker, "101");
    let target = Target::parse("101");
    let base = worker.frames.latest(&target, None).unwrap();
    state.lock().fail = true;
    // When
    let error = worker
        .process(Op::CaptureRegion(params("101")), &|| false)
        .unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert_eq!(
        worker.frames.latest(&target, Some(&full.frame_id)).unwrap(),
        base
    );
    state.lock().fail = false;
    let before = state.lock().captures.len();
    let error = worker
        .process(Op::CaptureRegion(params("101")), &|| true)
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(state.lock().captures.len(), before);
    let cancelled = std::cell::Cell::new(0);
    let error = worker
        .process(Op::CaptureRegion(params("101")), &|| {
            cancelled.set(cancelled.get() + 1);
            cancelled.get() >= 2
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(state.lock().captures.len(), before + 1);
    assert_eq!(
        worker.frames.latest(&target, Some(&full.frame_id)).unwrap(),
        base
    );
}

fn decode_base64(text: &str) -> Vec<u8> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0;
    for byte in text.bytes().take_while(|byte| *byte != b'=') {
        let value = alphabet
            .iter()
            .position(|candidate| *candidate == byte)
            .unwrap();
        buffer = (buffer << 6) | u32::try_from(value).unwrap();
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(u8::try_from((buffer >> bits) & 255).unwrap());
        }
    }
    output
}
