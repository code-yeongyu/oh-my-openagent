use super::*;
use crate::listing::{Rect, WindowIdentity};
use crate::results::DisplayInfo;

fn display(id: &str, x: f64, width: f64, height: f64, scale: f64) -> DisplayInfo {
    DisplayInfo {
        id: id.to_owned(),
        bounds: Rect {
            x,
            y: 0.0,
            width,
            height,
        },
        scale,
        primary: id == "1",
        truncated: None,
    }
}

fn basis() -> WindowIdentity {
    WindowIdentity {
        window_number: Some(101),
        hwnd: None,
        xid: None,
        pid: 4242,
        process_start: 0,
    }
}

#[test]
fn every_frame_refusal_has_its_table_row() {
    for refusal in FrameRefusal::ALL {
        assert!(refusal.refusal().computer_code().is_ok(), "{refusal:?}");
    }
    assert_eq!(
        FrameRefusal::IdentityChanged.refusal().code.wire(),
        "WindowNotFound"
    );
}

#[test]
fn window_frame_maps_through_the_current_origin_and_refuses_a_resize() {
    let bounds = Rect {
        x: 100.0,
        y: 120.0,
        width: 800.0,
        height: 600.0,
    };
    let frame = FrameGeometry::window(bounds, basis(), 1600, 1200, 1);
    assert_eq!(
        frame.map_point(20.0, 40.0, Some(&bounds)),
        Ok((110.0, 140.0))
    );
    let moved = Rect { x: 0.0, ..bounds };
    assert_eq!(frame.map_point(20.0, 40.0, Some(&moved)), Ok((10.0, 140.0)));
    let wider = Rect {
        width: 801.0,
        ..bounds
    };
    assert_eq!(
        frame.map_point(20.0, 40.0, Some(&wider)),
        Err(FrameRefusal::Resized)
    );
    assert_eq!(
        frame.map_point(1600.0, 0.0, Some(&bounds)),
        Err(FrameRefusal::OutsideFrame)
    );
    assert_eq!(
        frame.unmap_point(110.0, 140.0, Some(&bounds)),
        Some((20.0, 40.0))
    );
}

#[test]
fn composite_draws_at_the_top_scale_and_refuses_points_between_regions() {
    let displays = [
        display("1", 0.0, 1920.0, 1080.0, 1.0),
        display("2", 1920.0, 1440.0, 900.0, 2.0),
    ];
    let all = composite(&displays, &DisplaySelector::All, None).expect("composite");
    assert_eq!(
        (all.scale, all.width, all.height, all.truncated()),
        (2.0, 6720, 2160, false)
    );
    let frame = FrameGeometry::desktop(all.regions.clone(), all.width, all.height, 0);
    assert_eq!(frame.map_point(6719.0, 1799.0, None), Ok((3359.5, 899.5)));
    assert_eq!(
        frame.map_point(6719.0, 2000.0, None),
        Err(FrameRefusal::OutsideFrame)
    );
}

#[test]
fn display_all_17th_display_truncated() {
    let displays: Vec<DisplayInfo> = (1..=17)
        .map(|n| display(&n.to_string(), f64::from(n - 1) * 100.0, 100.0, 100.0, 1.0))
        .collect();
    let all = composite(&displays, &DisplaySelector::All, None).expect("composite");
    assert_eq!(all.shown.len(), MAX_COMPOSITE_DISPLAYS);
    assert!(all.truncated());
    assert_eq!(all.dropped, vec!["17".to_owned()]);
}

#[test]
fn active_display_is_the_largest_focused_window_intersection() {
    let displays = [
        display("1", 0.0, 1920.0, 1080.0, 1.0),
        display("2", 1920.0, 1440.0, 900.0, 2.0),
    ];
    let window = Rect {
        x: 1800.0,
        y: 0.0,
        width: 600.0,
        height: 400.0,
    };
    let active = composite(&displays, &DisplaySelector::Active, Some(&window)).expect("active");
    assert_eq!(active.shown[0].id, "2");
    assert_eq!(
        DisplaySelector::parse("display:2"),
        Some(DisplaySelector::Id("2".to_owned()))
    );
    assert_eq!(DisplaySelector::parse("101"), None);
}

#[test]
fn ladder_steps_png_then_jpeg_then_artifact() {
    struct Half;
    impl Reencode for Half {
        fn jpeg(&self, png: &[u8], _quality: u8) -> Option<Vec<u8>> {
            Some(png[..png.len() / 2].to_vec())
        }
    }
    assert_eq!(
        ladder(vec![0; 4], 4, &NoJpeg),
        Delivery::InlinePng(vec![0; 4])
    );
    assert_eq!(
        ladder(vec![0; 8], 4, &Half),
        Delivery::InlineJpeg(vec![0; 4])
    );
    assert_eq!(
        ladder(vec![0; 8], 4, &NoJpeg),
        Delivery::Artifact(vec![0; 8])
    );
}
