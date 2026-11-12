//! `displays()`: each RandR monitor as a `DisplayInfo` whose bounds are logical points
//! (device pixels divided by the monitor's scale), identified by the monitor's name.

use omo_computer_core::listing::Rect;
use omo_computer_core::results::DisplayInfo;

use crate::capture::server::Monitor;
use crate::monitors::MonitorReading;

/// The id a monitor answers to: its RandR name, else its name atom.
#[must_use]
pub fn display_id(monitor: &Monitor) -> String {
    monitor.atom.to_string()
}

/// The `DisplayInfo` of one monitor reading.
#[must_use]
pub fn display_info(reading: &MonitorReading) -> DisplayInfo {
    let rect = reading.monitor.rect;
    let scale = reading.scale;
    DisplayInfo {
        id: display_id(&reading.monitor),
        bounds: Rect {
            x: f64::from(rect.x) / scale,
            y: f64::from(rect.y) / scale,
            width: f64::from(rect.width) / scale,
            height: f64::from(rect.height) / scale,
        },
        scale,
        primary: reading.monitor.primary,
        truncated: None,
    }
}

/// Every monitor reading as a `DisplayInfo`, in RandR order.
#[must_use]
pub fn display_infos(readings: &[MonitorReading]) -> Vec<DisplayInfo> {
    readings.iter().map(display_info).collect()
}

#[cfg(test)]
mod tests {
    use omo_computer_core::frame::{composite, DisplaySelector};

    use super::*;
    use crate::capture::fake::FakeX;
    use crate::monitors;

    #[test]
    fn displays_complete_on_two_screen_fixture() {
        let server = FakeX::two_screens();
        let readings = monitors::read(&server, None).expect("monitors");
        let displays = display_infos(&readings);
        let ids: Vec<&str> = displays.iter().map(|display| display.id.as_str()).collect();
        assert_eq!(ids, ["DP-1", "HDMI-1"]);
        assert_eq!(
            displays[1].bounds,
            Rect {
                x: 1280.0,
                y: 0.0,
                width: 1024.0,
                height: 768.0
            }
        );
        assert!(displays[0].primary && !displays[1].primary);
        let plan = composite(&displays, &DisplaySelector::All, None).expect("composite");
        assert_eq!(plan.shown.len(), 2);
        assert!(!plan.truncated());
        assert_eq!((plan.width, plan.height), (2304, 800));
    }

    #[test]
    fn display_bounds_are_logical_at_scale_2() {
        let server = FakeX::single(400, 200).with_resources("Xft.dpi: 192\n");
        let readings = monitors::read(&server, None).expect("monitors");
        let display = display_info(&readings[0]);
        assert_eq!((display.bounds.width, display.bounds.height), (200.0, 100.0));
        assert!((display.scale - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn no_randr_monitor_lists_the_whole_screen() {
        let server = FakeX::single(640, 480).without_randr();
        let readings = monitors::read(&server, None).expect("monitors");
        let displays = display_infos(&readings);
        assert_eq!(displays.len(), 1);
        assert_eq!(displays[0].id, "screen");
        assert!(displays[0].primary);
    }
}
