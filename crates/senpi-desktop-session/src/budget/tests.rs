use std::path::{Path, PathBuf};

use image::{Rgba, RgbaImage};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{CaptureCaps, CaptureMode};

use super::encode::format_bytes;
use super::{plan_screenshot, Budget, Delivery, ScreenshotResult};

/// Deterministic per-pixel noise: PNG cannot compress it, JPEG q70 can.
fn noise(width: u32, height: u32) -> RgbaImage {
    RgbaImage::from_fn(width, height, |x, y| {
        let mut state = (u64::from(x) << 32 | u64::from(y) | 1).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        state ^= state >> 29;
        state = state.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        state ^= state >> 32;
        let [r, g, b, ..] = state.to_le_bytes();
        Rgba([r, g, b, 255])
    })
}

fn solid(width: u32, height: u32) -> RgbaImage {
    RgbaImage::from_pixel(width, height, Rgba([32, 96, 160, 255]))
}

fn caps(max_width: Option<u32>, max_height: Option<u32>, coordinate_safe: bool) -> CaptureCaps {
    CaptureCaps {
        max_width,
        max_height,
        coordinate_safe,
        ..CaptureCaps::default()
    }
}

fn with_bytes(max_bytes: u64) -> CaptureCaps {
    CaptureCaps {
        max_bytes,
        ..CaptureCaps::default()
    }
}

fn plan(source: RgbaImage, session: &CaptureCaps, dir: &Path) -> ScreenshotResult {
    let budget = Budget::new(session, None, dir.to_path_buf()).expect("valid caps");
    plan_screenshot(source, &mut FrameGeometry::identity_global(), &budget).expect("plans")
}

fn artifact(result: &ScreenshotResult) -> &PathBuf {
    match &result.delivery {
        Delivery::ArtifactOnly { path, .. } => path,
        other => panic!("expected artifact-only, got {:?}", other.mode()),
    }
}

/// (name, source, session caps, expected capped size).
type DimensionCase = (&'static str, RgbaImage, CaptureCaps, (u32, u32));

fn assert_dimensions(cases: Vec<DimensionCase>) {
    let dir = tempfile::tempdir().expect("tempdir");
    for (name, source, session, expected) in cases {
        let source_size = source.dimensions();
        let result = plan(source, &session, dir.path());
        assert_eq!((result.width, result.height), expected, "{name}: capped size");
        assert_eq!(
            (result.source_width, result.source_height),
            source_size,
            "{name}: source size"
        );
        assert_eq!(result.delivery.mode(), CaptureMode::InlinePng, "{name}: mode");
    }
}

#[test]
fn png_fits() {
    // Given: noise whose PNG (~1.9 MB) is under the budget.
    let dir = tempfile::tempdir().expect("tempdir");
    // When
    let result = plan(noise(800, 600), &with_bytes(2_500_000), dir.path());
    // Then
    assert!(matches!(result.delivery, Delivery::InlinePng(ref png) if png.len() <= 2_500_000));
}

#[test]
fn jpeg_fallback() {
    // Given: a budget below the noise PNG (~1.9 MB) but above its JPEG (~0.55 MB).
    let dir = tempfile::tempdir().expect("tempdir");
    // When
    let result = plan(noise(800, 600), &with_bytes(1_000_000), dir.path());
    // Then
    let Delivery::InlineJpeg { jpeg, note } = &result.delivery else {
        panic!("expected inline-jpeg, got {:?}", result.delivery.mode());
    };
    assert!(
        jpeg.len() <= 1_000_000 && jpeg.starts_with(&[0xff, 0xd8]),
        "a JPEG within budget"
    );
    assert!(!note.is_empty(), "a degraded capture carries a note");
}

#[test]
fn artifact_only() {
    // Given: a 1600x1200 source capped to 800x600, and a budget no form fits.
    let dir = tempfile::tempdir().expect("tempdir");
    let session = CaptureCaps {
        max_bytes: 100_000,
        ..caps(Some(800), None, false)
    };
    // When
    let result = plan(noise(1600, 1200), &session, dir.path());
    // Then: the saved artifact is the full-resolution PNG, owner-only.
    let path = artifact(&result);
    assert!(matches!(&result.delivery, Delivery::ArtifactOnly { note, .. } if !note.is_empty()));
    assert_eq!(path.parent(), Some(dir.path()));
    let saved = image::open(path).expect("artifact is a PNG");
    assert_eq!((saved.width(), saved.height()), (1600, 1200));
    assert_eq!((result.width, result.height, result.scale()), (800, 600, 0.5));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .expect("artifact exists")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn coordinate_safe_caps_1280x896() {
    assert_dimensions(vec![
        (
            "landscape",
            solid(2560, 1600),
            caps(None, None, true),
            (1280, 800),
        ),
        ("portrait", solid(1600, 2560), caps(None, None, true), (560, 896)),
        (
            "host-tighter",
            solid(2560, 1600),
            caps(Some(1000), None, true),
            (1000, 625),
        ),
        (
            "8000x4000",
            solid(8000, 4000),
            caps(None, None, true),
            (1280, 640),
        ),
    ]);
}

#[test]
fn no_cap_when_host_allows_original() {
    assert_dimensions(vec![
        (
            "fits-default",
            solid(2560, 1600),
            caps(None, None, false),
            (2560, 1600),
        ),
        (
            "host-original",
            solid(5120, 2880),
            caps(Some(5120), Some(2880), false),
            (5120, 2880),
        ),
        (
            "8000x4000-default",
            solid(8000, 4000),
            caps(None, None, false),
            (3840, 1920),
        ),
    ]);
}

#[test]
fn a_call_can_tighten_but_never_loosen_the_session_caps() {
    // Given: a coordinate-safe session with a 1 MB budget.
    let session = CaptureCaps {
        max_bytes: 1_000_000,
        ..caps(None, None, true)
    };
    let loosening = CaptureCaps {
        max_bytes: 50_000_000,
        ..caps(Some(3000), Some(3000), false)
    };
    // When
    let budget = Budget::new(&session, Some(&loosening), PathBuf::new()).expect("valid caps");
    let tightening =
        Budget::new(&session, Some(&caps(Some(640), None, false)), PathBuf::new()).expect("valid");
    // Then
    let resolved = |budget: &Budget| {
        (
            budget.caps().max_width,
            budget.caps().max_height,
            budget.caps().max_bytes,
        )
    };
    assert_eq!(resolved(&budget), (Some(1280), Some(896), 1_000_000));
    assert_eq!(resolved(&tightening), (Some(640), Some(896), 1_000_000));
}

#[test]
fn a_zero_byte_budget_is_invalid_target() {
    // Given / When
    let from_session = Budget::new(&with_bytes(0), None, PathBuf::new());
    let from_call = Budget::new(&CaptureCaps::default(), Some(&with_bytes(0)), PathBuf::new());
    // Then
    for budget in [from_session, from_call] {
        assert_eq!(
            budget.map(|_| ()).map_err(|error| error.code),
            Err(ErrorCode::InvalidTarget)
        );
    }
}

#[test]
fn byte_counts_read_as_bytes_kib_or_mib() {
    let vectors = [
        (1, "1 bytes"),
        (1023, "1023 bytes"),
        (1024, "1 KiB"),
        (1_000_000, "977 KiB"),
        (5_000_000, "4.8 MiB"),
        (5 * 1024 * 1024, "5.0 MiB"),
    ];
    for (bytes, expected) in vectors {
        assert_eq!(format_bytes(bytes), expected, "format_bytes({bytes})");
    }
}
