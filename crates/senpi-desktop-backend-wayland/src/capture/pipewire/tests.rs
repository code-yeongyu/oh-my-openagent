use image::RgbaImage;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::DesktopWindow;

use super::composite;
use super::lib::loadable;
use super::pixels::to_rgba;
use super::pod::{enum_format, parse_format, Negotiated, VideoFormat};
use super::screencast::MonitorStream;
use super::window::{crop_window, window_crop};

fn words(bytes: &[u8]) -> Vec<u32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_ne_bytes(*w))
        .collect()
}

/// A `Format` object pod as PipeWire sends it: mediaType video, a fixed
/// VideoFormat id, and a fixed VideoSize rectangle.
fn format_pod(format: u32, width: u32, height: u32) -> Vec<u8> {
    let body: Vec<u32> = vec![
        0x40003, 4, // object type Format, id Format
        1, 0, 4, 3, 2, 0, // mediaType: Id video (padded)
        0x20001, 0, 4, 3, format, 0, // VideoFormat: Id
        0x20003, 0, 8, 10, width, height, // VideoSize: Rectangle
    ];
    let mut pod = vec![u32::try_from(body.len() * 4).unwrap(), 15];
    pod.extend(body);
    pod.iter().flat_map(|w| w.to_ne_bytes()).collect()
}

#[test]
fn enum_format_is_an_8_byte_aligned_format_object_offering_every_packed_rgb_layout() {
    let pod = enum_format();
    let w = words(&pod);
    assert_eq!(pod.len() % 8, 0);
    assert_eq!(w[1], 15, "SPA_TYPE_Object");
    assert_eq!(w[0] as usize, pod.len() - 8, "header size is the body size");
    assert_eq!(&w[2..4], &[0x40003, 3], "Format object, EnumFormat id");
    for format in [7, 8, 11, 12, 15, 16] {
        assert!(w.contains(&format), "offers video format {format}");
    }
}

#[test]
fn parse_format_reads_the_negotiated_layout_and_size() {
    assert_eq!(
        parse_format(&format_pod(8, 1920, 1080)),
        Some(Negotiated {
            format: VideoFormat::Bgrx,
            width: 1920,
            height: 1080
        })
    );
    assert_eq!(
        parse_format(&format_pod(15, 2, 1)).map(|n| n.format),
        Some(VideoFormat::Rgb)
    );
}

#[test]
fn parse_format_rejects_unreadable_formats_empty_sizes_and_foreign_pods() {
    assert_eq!(
        parse_format(&format_pod(2, 64, 64)),
        None,
        "I420 is not packed RGB"
    );
    assert_eq!(parse_format(&format_pod(8, 0, 64)), None, "empty frame");
    assert_eq!(parse_format(&enum_format()[..12]), None, "truncated pod");
    let mut foreign = format_pod(8, 4, 4);
    foreign[4] = 3;
    assert_eq!(parse_format(&foreign), None, "not an Object pod");
}

fn frame(format: VideoFormat, width: u32, height: u32) -> Negotiated {
    Negotiated {
        format,
        width,
        height,
    }
}

#[test]
fn to_rgba_swizzles_every_packed_layout_and_honors_alpha_only_where_present() {
    let cases: [(VideoFormat, &[u8], [u8; 4]); 6] = [
        (VideoFormat::Rgbx, &[1, 2, 3, 9], [1, 2, 3, 255]),
        (VideoFormat::Bgrx, &[3, 2, 1, 9], [1, 2, 3, 255]),
        (VideoFormat::Rgba, &[1, 2, 3, 9], [1, 2, 3, 9]),
        (VideoFormat::Bgra, &[3, 2, 1, 9], [1, 2, 3, 9]),
        (VideoFormat::Rgb, &[1, 2, 3], [1, 2, 3, 255]),
        (VideoFormat::Bgr, &[3, 2, 1], [1, 2, 3, 255]),
    ];
    for (format, pixel, expected) in cases {
        let image = to_rgba(frame(format, 1, 1), pixel, pixel.len()).unwrap();
        assert_eq!(image.get_pixel(0, 0).0, expected, "{format:?}");
    }
}

#[test]
fn to_rgba_skips_row_padding_and_rejects_a_short_buffer() {
    let padded = [10, 20, 30, 0, 0, 0, 40, 50, 60, 0, 0, 0];
    let image = to_rgba(frame(VideoFormat::Rgb, 1, 2), &padded, 6).unwrap();
    assert_eq!(
        [image.get_pixel(0, 0).0, image.get_pixel(0, 1).0],
        [[10, 20, 30, 255], [40, 50, 60, 255]]
    );
    let short = to_rgba(frame(VideoFormat::Bgrx, 2, 2), &[0; 12], 8).unwrap_err();
    assert!(short.contains("short"), "{short}");
    assert!(
        to_rgba(frame(VideoFormat::Bgrx, 2, 1), &[0; 8], 4).is_err(),
        "stride below the row size"
    );
}

#[test]
fn monitors_composite_at_their_logical_positions_with_their_own_scale() {
    let left = MonitorStream {
        node: 1,
        position: (0, 0),
        size: Some((2, 2)),
    };
    let right = MonitorStream {
        node: 2,
        position: (2, 0),
        size: Some((2, 1)),
    };
    let (canvas, displays) = composite(&[
        (left, RgbaImage::from_pixel(2, 2, [1, 1, 1, 255].into())),
        (right, RgbaImage::from_pixel(4, 2, [2, 2, 2, 255].into())),
    ]);
    assert_eq!((canvas.width(), canvas.height()), (8, 2));
    assert_eq!(
        displays.iter().map(|d| (d.pixel_x, d.scale)).collect::<Vec<_>>(),
        vec![(0, 1.0), (4, 2.0)]
    );
    assert_eq!(
        [canvas.get_pixel(1, 1).0, canvas.get_pixel(4, 0).0],
        [[1, 1, 1, 255], [2, 2, 2, 255]]
    );
}

#[test]
fn a_missing_libpipewire_is_reported_not_loadable() {
    assert!(!loadable("libpipewire-senpi-does-not-exist.so.0"));
}

fn portal_window(id: &str, x: i32, y: i32, width: u32, height: u32) -> DesktopWindow {
    DesktopWindow {
        id: id.to_owned(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x,
        y,
        width,
        height,
        focused: false,
        elevated: None,
    }
}

/// One HiDPI monitor at logical (100, 50), 1280x1440, streaming 2560x2880 pixels.
fn hidpi_monitor() -> (RgbaImage, Vec<senpi_desktop_core::types::DesktopDisplay>) {
    let monitor = MonitorStream {
        node: 1,
        position: (100, 50),
        size: Some((1280, 1440)),
    };
    let (canvas, mut displays) = composite(&[(monitor, RgbaImage::new(2560, 2880))]);
    displays[0].x = 100;
    displays[0].y = 50;
    (canvas, displays)
}

#[test]
fn missing_portal_size_falls_back_to_buffer_scale_one() {
    let unsized_monitor = MonitorStream {
        node: 1,
        position: (0, 0),
        size: None,
    };
    let degenerate = MonitorStream {
        node: 2,
        position: (0, 0),
        size: Some((0, 0)),
    };
    for monitor in [unsized_monitor, degenerate] {
        let (_, displays) = composite(&[(monitor, RgbaImage::new(1920, 1080))]);
        assert_eq!(
            (displays[0].width, displays[0].height, displays[0].scale),
            (1920, 1080, 1.0)
        );
    }
}

#[test]
fn scaled_monitor_maps_screenshot_pixel_to_logical_point() {
    let monitor = MonitorStream {
        node: 1,
        position: (0, 0),
        size: Some((1280, 1440)),
    };
    let (_, displays) = composite(&[(monitor, RgbaImage::new(2560, 2880))]);
    let frame = FrameGeometry::for_displays(&displays);
    assert_eq!(frame.map_point(1280.0, 1440.0, None).unwrap(), (640.0, 720.0));
}

#[test]
fn monitor_offset_is_added_to_logical_point() {
    let (_, displays) = hidpi_monitor();
    let frame = FrameGeometry::for_displays(&displays);
    assert_eq!(frame.map_point(1280.0, 1440.0, None).unwrap(), (740.0, 770.0));
}

#[test]
fn window_crop_scales_logical_bounds_to_buffer_pixels() {
    let (_, displays) = hidpi_monitor();
    assert_eq!(
        window_crop(&displays, &portal_window("w", 200, 250, 300, 400)),
        Some((200, 400, 600, 800))
    );
}

#[test]
fn window_crop_rejects_window_outside_monitor() {
    let (_, displays) = hidpi_monitor();
    assert_eq!(
        window_crop(&displays, &portal_window("w", 2100, 50, 100, 100)),
        None
    );
    assert_eq!(
        window_crop(&displays, &portal_window("w", 90, 50, 100, 100)),
        None
    );
}

/// oh-my-pi's worker-level test (desktop/mod.rs), at the crop seam: Wayland ids are AT-SPI strings, never parsed.
#[test]
fn capture_accepts_non_numeric_wayland_window_id() {
    let (canvas, displays) = hidpi_monitor();
    let id = "atspi::1.31:/org/a11y/atspi/accessible/1";
    let (image, _) = crop_window(&canvas, &displays, vec![portal_window(id, 100, 50, 32, 24)], id).unwrap();
    assert_eq!(image.dimensions(), (64, 48));
}

#[test]
fn capture_rejects_unknown_window_id_via_backend_lookup() {
    let (canvas, displays) = hidpi_monitor();
    let error = crop_window(
        &canvas,
        &displays,
        vec![portal_window("w", 100, 50, 10, 10)],
        "does-not-exist",
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::WindowNotFound);
}
