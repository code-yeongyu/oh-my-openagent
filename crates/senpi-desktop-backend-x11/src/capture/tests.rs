//! Pixel conversion, root clipping, `WM_CLASS` parsing and RandR layout.

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::DisplaySelector;

use super::fake::{FakeServer, MASKS};
use super::image::{clip_to_root, to_rgba, ColorMasks, Pixmap, RootRect};
use super::monitors::displays;
use super::windows::parse_wm_class;

fn pixmap(width: u32, height: u32, bits_per_pixel: u8, data: Vec<u8>) -> Pixmap {
    Pixmap {
        width,
        height,
        depth: 24,
        bits_per_pixel,
        scanline_pad: 32,
        lsb_first: true,
        data,
    }
}

fn rect(x: i32, y: i32, width: u32, height: u32) -> RootRect {
    RootRect { x, y, width, height }
}

#[test]
fn lsb_first_32bpp_pixels_decode_to_opaque_rgba() {
    let source = pixmap(2, 1, 32, vec![0x30, 0x20, 0x10, 0x00, 0xff, 0x00, 0x80, 0xaa]);

    let image = to_rgba(&source, MASKS).unwrap();

    assert_eq!(
        image.as_raw(),
        &vec![0x10, 0x20, 0x30, 255, 0x80, 0x00, 0xff, 255]
    );
}

#[test]
fn msb_first_24bpp_rows_skip_scanline_padding() {
    let source = Pixmap {
        lsb_first: false,
        ..pixmap(1, 2, 24, vec![0x01, 0x02, 0x03, 0xee, 0x04, 0x05, 0x06, 0xee])
    };

    let image = to_rgba(&source, MASKS).unwrap();

    assert_eq!(
        image.as_raw(),
        &vec![0x01, 0x02, 0x03, 255, 0x04, 0x05, 0x06, 255]
    );
}

#[test]
fn ten_bit_channels_scale_to_the_full_byte_range() {
    let masks = ColorMasks {
        red: 0x3ff0_0000,
        green: 0x000f_fc00,
        blue: 0x0000_03ff,
    };
    let pixel: u32 = (0x3ff << 20) | (0x200 << 10);
    let source = Pixmap {
        depth: 30,
        ..pixmap(1, 1, 32, pixel.to_le_bytes().to_vec())
    };

    let image = to_rgba(&source, masks).unwrap();

    assert_eq!(image.as_raw(), &vec![255, 128, 0, 255]);
}

#[test]
fn truncated_image_data_is_capture_failed() {
    let source = pixmap(2, 2, 32, vec![0; 12]);

    let error = to_rgba(&source, MASKS).unwrap_err();

    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(
        error.message.contains("expected 16 bytes, got 12"),
        "{}",
        error.message
    );
}

#[test]
fn unsupported_depths_and_pixel_sizes_are_rejected() {
    let shallow = Pixmap {
        depth: 16,
        ..pixmap(1, 1, 32, vec![0; 4])
    };
    let packed = pixmap(1, 1, 16, vec![0; 4]);

    let errors = [to_rgba(&shallow, MASKS), to_rgba(&packed, MASKS)].map(|result| result.unwrap_err().code);

    assert_eq!(errors, [ErrorCode::CaptureFailed, ErrorCode::CaptureFailed]);
}

#[test]
fn zero_non_contiguous_or_overlapping_masks_are_rejected() {
    let source = pixmap(1, 1, 32, vec![0; 4]);
    let invalid = [
        ColorMasks { red: 0, ..MASKS },
        ColorMasks {
            red: 0x00f0_f000,
            ..MASKS
        },
        ColorMasks {
            green: 0x00ff_ff00,
            ..MASKS
        },
    ];

    for masks in invalid {
        assert_eq!(
            to_rgba(&source, masks).unwrap_err().code,
            ErrorCode::CaptureFailed
        );
    }
}

#[test]
fn clipping_trims_the_offscreen_part_of_a_window() {
    assert_eq!(
        clip_to_root(rect(-10, 700, 100, 200), 1280, 800),
        Some(rect(0, 700, 90, 100))
    );
    assert_eq!(
        clip_to_root(rect(10, 20, 30, 40), 1280, 800),
        Some(rect(10, 20, 30, 40))
    );
}

#[test]
fn clipping_a_fully_offscreen_window_yields_nothing() {
    assert_eq!(clip_to_root(rect(1280, 0, 10, 10), 1280, 800), None);
    assert_eq!(clip_to_root(rect(-10, -10, 10, 10), 1280, 800), None);
}

#[test]
fn wm_class_names_the_class_and_falls_back_to_the_instance() {
    assert_eq!(parse_wm_class(b"xterm\0XTerm\0"), "XTerm");
    assert_eq!(parse_wm_class(b"solo\0"), "solo");
    assert_eq!(parse_wm_class(b""), "");
}

#[test]
fn randr_monitors_share_one_pixel_space_rooted_at_the_top_left() {
    let server = FakeServer::new(3200, 1080)
        .monitor("DP-1", (-1920, 0, 1920, 1080), false)
        .monitor("HDMI-1", (0, 100, 1280, 800), true);

    let result = displays(&server, &DisplaySelector::All).unwrap();

    let layout: Vec<_> = result
        .iter()
        .map(|d| {
            (
                d.name.as_str(),
                d.pixel_x,
                d.pixel_y,
                d.pixel_width,
                d.scale,
                d.is_primary,
            )
        })
        .collect();
    assert_eq!(
        layout,
        [
            ("DP-1", 0, 0, 1920, 1.0, false),
            ("HDMI-1", 1920, 100, 1280, 1.0, true)
        ]
    );
    assert_eq!(result[0].id, server.intern("DP-1").to_string());
}

#[test]
fn selecting_one_monitor_by_name_or_id_rebases_its_pixels_to_zero() {
    let server = FakeServer::new(3200, 1080)
        .monitor("DP-1", (0, 0, 1920, 1080), true)
        .monitor("HDMI-1", (1920, 0, 1280, 800), false);
    let by_id = DisplaySelector::Id(server.intern("HDMI-1").to_string());

    for selector in [DisplaySelector::Id("HDMI-1".into()), by_id] {
        let selected = displays(&server, &selector).unwrap();
        let summary: Vec<_> = selected
            .iter()
            .map(|d| (d.name.as_str(), d.x, d.pixel_x))
            .collect();
        assert_eq!(summary, [("HDMI-1", 1920, 0)]);
    }
}

#[test]
fn an_inactive_display_selector_is_capture_failed() {
    let server = FakeServer::new(1280, 800).monitor("DP-1", (0, 0, 1280, 800), true);

    let error = displays(&server, &DisplaySelector::Id("999".into())).unwrap_err();

    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert_eq!(error.message, "configured X11 display was not found");
}

#[test]
fn without_randr_monitors_the_root_screen_is_the_only_display() {
    let server = FakeServer::new(1280, 800);

    let result = displays(&server, &DisplaySelector::All).unwrap();

    let summary: Vec<_> = result
        .iter()
        .map(|d| (d.id.as_str(), d.width, d.height, d.is_primary))
        .collect();
    assert_eq!(summary, [("0", 1280, 800, true)]);
}
