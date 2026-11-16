//! `windows()`: the EWMH clients, topmost first, each with its identity `{xid, pid,
//! processStart}` and logical bounds on the monitor holding its centre. Minimized windows are
//! listed, never filtered.

use std::fs;
use std::os::unix::fs::MetadataExt;

use omo_computer_core::backend::{WindowFilter, WindowList};
use omo_computer_core::listing::{Rect, WindowIdentity, WindowInfo};
use omo_computer_core::untrusted::UntrustedText;

use super::server::ClientWindow;
use crate::displays::display_id;
use crate::monitors::MonitorReading;

/// What `/proc` says about a client's process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProcessFacts {
    /// `starttime` of `/proc/<pid>/stat` (clock ticks since boot).
    pub start: u64,
    /// The process belongs to another uid than this engine's.
    pub elevated: bool,
}

/// Reads `/proc/<pid>`; a process gone or unreadable reads as start 0, not elevated.
#[must_use]
pub fn process_facts(pid: u32) -> ProcessFacts {
    let start = fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| {
            let after_comm = stat.rsplit_once(')')?.1;
            after_comm.split_whitespace().nth(19)?.parse().ok()
        })
        .unwrap_or(0);
    let owner = fs::metadata(format!("/proc/{pid}")).map(|meta| meta.uid());
    let own = fs::metadata("/proc/self").map(|meta| meta.uid());
    let elevated = matches!((owner, own), (Ok(owner), Ok(own)) if owner != own);
    ProcessFacts { start, elevated }
}

fn matches(filter: &WindowFilter, client: &ClientWindow) -> bool {
    let app = filter
        .app
        .as_ref()
        .is_none_or(|app| client.class.eq_ignore_ascii_case(app));
    let title = filter
        .title
        .as_ref()
        .is_none_or(|title| client.title.contains(title.as_str()));
    let pid = filter.pid.is_none_or(|pid| client.pid == Some(pid));
    app && title && pid
}

fn monitor_of<'a>(readings: &'a [MonitorReading], client: &ClientWindow) -> Option<&'a MonitorReading> {
    let rect = client.placement.rect;
    let half = |extent: u32| i32::try_from(extent / 2).unwrap_or(i32::MAX);
    let (x, y) = (rect.x.saturating_add(half(rect.width)), rect.y.saturating_add(half(rect.height)));
    readings
        .iter()
        .find(|reading| reading.monitor.rect.contains(x, y))
        .or_else(|| readings.first())
}

fn info(
    client: &ClientWindow,
    z: usize,
    readings: &[MonitorReading],
    facts: &impl Fn(u32) -> ProcessFacts,
) -> WindowInfo {
    let monitor = monitor_of(readings, client);
    let scale = monitor.map_or(1.0, |reading| reading.scale);
    let rect = client.placement.rect;
    let process = client.pid.map(facts).unwrap_or_default();
    let on_screen = readings
        .iter()
        .any(|reading| overlaps(reading.monitor.rect, rect));
    WindowInfo {
        id: client.xid.to_string(),
        identity: WindowIdentity {
            window_number: None,
            hwnd: None,
            xid: Some(client.xid),
            pid: client.pid.unwrap_or(0),
            process_start: process.start,
        },
        app: client.class.clone(),
        app_key: client.class.clone(),
        title: client.title.clone(),
        bounds: Rect {
            x: f64::from(rect.x) / scale,
            y: f64::from(rect.y) / scale,
            width: f64::from(rect.width) / scale,
            height: f64::from(rect.height) / scale,
        },
        display: monitor.map(|reading| display_id(&reading.monitor)).unwrap_or_default(),
        focused: client.focused,
        is_on_screen: client.placement.viewable && !client.placement.minimized && on_screen,
        space: client.desktop.map(|desktop| desktop.to_string()),
        minimized: client.placement.minimized,
        elevated: process.elevated,
        z: u32::try_from(z).unwrap_or(u32::MAX),
        observation: UntrustedText,
    }
}

fn overlaps(a: super::server::PixelRect, b: super::server::PixelRect) -> bool {
    let right = |r: super::server::PixelRect| i64::from(r.x) + i64::from(r.width);
    let bottom = |r: super::server::PixelRect| i64::from(r.y) + i64::from(r.height);
    i64::from(a.x) < right(b) && i64::from(b.x) < right(a) && i64::from(a.y) < bottom(b) && i64::from(b.y) < bottom(a)
}

/// The filtered listing; `z` counts every client, so it is the stacking index.
#[must_use]
pub fn list_windows(
    clients: &[ClientWindow],
    readings: &[MonitorReading],
    filter: &WindowFilter,
    facts: &impl Fn(u32) -> ProcessFacts,
) -> WindowList {
    let windows = clients
        .iter()
        .enumerate()
        .filter(|(_, client)| matches(filter, client))
        .map(|(z, client)| info(client, z, readings, facts))
        .collect();
    WindowList {
        windows,
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::fake::{FakeX, GREEN};
    use crate::capture::server::{PixelRect, WindowPlacement};
    use crate::monitors;

    fn client(xid: u32, title: &str, minimized: bool) -> ClientWindow {
        ClientWindow {
            xid,
            title: title.to_owned(),
            class: "XTerm".to_owned(),
            pid: Some(4242),
            focused: xid == 2,
            desktop: Some(0),
            placement: WindowPlacement {
                rect: PixelRect {
                    x: 1400,
                    y: 100,
                    width: 200,
                    height: 100,
                },
                border: 0,
                viewable: !minimized,
                minimized,
                visual: 33,
            },
        }
    }

    #[test]
    fn windows_carry_identity_scale_and_list_minimized() {
        let server = FakeX::two_screens().with_window(5, PixelRect { x: 0, y: 0, width: 10, height: 10 }, GREEN);
        let readings = monitors::read(&server, None).expect("monitors");
        let clients = [client(2, "top", false), client(3, "hidden", true)];
        let facts = |_| ProcessFacts { start: 777, elevated: false };
        let list = list_windows(&clients, &readings, &WindowFilter::default(), &facts);
        assert_eq!(list.windows.len(), 2);
        let top = &list.windows[0];
        assert_eq!((top.id.as_str(), top.z, top.focused), ("2", 0, true));
        assert_eq!(top.identity.xid, Some(2));
        assert_eq!((top.identity.pid, top.identity.process_start), (4242, 777));
        assert_eq!(top.display, "HDMI-1");
        assert!(top.is_on_screen);
        let hidden = &list.windows[1];
        assert!(hidden.minimized && !hidden.is_on_screen);
        let only = WindowFilter {
            title: Some("hid".into()),
            ..WindowFilter::default()
        };
        let filtered = list_windows(&clients, &readings, &only, &facts);
        assert_eq!(filtered.windows.len(), 1);
        assert_eq!(filtered.windows[0].z, 1);
    }

    #[test]
    fn own_process_is_read_from_proc() {
        let facts = process_facts(std::process::id());
        assert!(facts.start > 0);
        assert!(!facts.elevated);
    }
}
