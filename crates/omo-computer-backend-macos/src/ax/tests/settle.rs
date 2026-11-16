//! The observer feed, the loading predicate (amendment A4) and the notification surface.

use omo_computer_core::backend::{AxEvent, SettleSource, NO_NOTIFICATION_SURFACE};
use omo_computer_core::observation::BusyIndicator;

use super::kit::{node, FakeAx};
use crate::ax::notifications::body_hash;
use crate::ax::seam::{Attributes, Notified};
use crate::ax::MacAx;

fn window_with(child: Attributes) -> FakeAx {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.add(100, node("AXWindow"), vec![101]);
    fake.add(101, child, Vec::new());
    fake
}

#[test]
fn busy_indicator_reports_loading_until_cleared() {
    let loading = Attributes {
        loaded: Some(false),
        ..node("AXWebArea")
    };
    let mut ax = MacAx::new(window_with(loading));
    assert_eq!(ax.busy("7"), Ok(Some(BusyIndicator::AxBusy)));
    ax.server_mut()
        .nodes
        .get_mut(&101)
        .expect("web area")
        .0
        .loaded = Some(true);
    assert_eq!(ax.busy("7"), Ok(None), "loaded clears it");
}

#[test]
fn busy_predicate_names_progress_spinner_and_element_busy() {
    let cases = [
        (
            Attributes {
                indeterminate: Some(true),
                ..node("AXProgressIndicator")
            },
            Some(BusyIndicator::Progress),
        ),
        (node("AXBusyIndicator"), Some(BusyIndicator::Spinner)),
        (
            Attributes {
                busy: Some(true),
                ..node("AXGroup")
            },
            Some(BusyIndicator::AxBusy),
        ),
        (
            Attributes {
                indeterminate: Some(false),
                ..node("AXProgressIndicator")
            },
            None,
        ),
    ];
    for (child, expected) in cases {
        let mut ax = MacAx::new(window_with(child.clone()));
        assert_eq!(ax.busy("7"), Ok(expected), "{child:?}");
    }
}

#[test]
fn wait_event_is_fed_by_the_observer_until_the_deadline() {
    let mut fake = window_with(node("AXTextField"));
    fake.queue.push_back((
        50,
        Notified {
            notification: "AXValueChanged".into(),
            pid: 70,
            element: 101,
            window: Some(7),
        },
    ));
    let mut ax = MacAx::new(fake);
    ax.busy("7").expect("registers the observer");
    assert_eq!(
        ax.wait_event(100),
        Ok(Some(AxEvent {
            kind: "AXValueChanged".into(),
            window: "7".into()
        }))
    );
    assert_eq!(ax.wait_event(200), Ok(None));
    assert_eq!(
        ax.server().now,
        200,
        "waited to the deadline, never past it"
    );
    assert_eq!(
        ax.server().observed,
        vec![70],
        "one observer per target app"
    );
}

#[test]
fn macos_notification_banner_fingerprint_and_unavailable_when_absent() {
    let mut ax = MacAx::new(FakeAx::default());
    assert_eq!(ax.notifications(), Err(NO_NOTIFICATION_SURFACE));

    let mut fake = FakeAx::default();
    fake.bundles
        .insert("com.apple.notificationcenterui".into(), 900);
    fake.apps.insert(900, 9_000);
    fake.add(9_000, node("AXApplication"), vec![9_001]);
    let banner = Attributes {
        subrole: Some("AXNotificationCenterBanner".into()),
        ..node("AXWindow")
    };
    fake.add(9_001, banner, vec![9_002, 9_003, 9_004]);
    for (element, text) in [
        (9_002, "Mail"),
        (9_003, "New message"),
        (9_004, "Hello there"),
    ] {
        fake.add(
            element,
            Attributes {
                value: Some(text.into()),
                ..node("AXStaticText")
            },
            Vec::new(),
        );
    }
    fake.queue.push_back((
        40,
        Notified {
            notification: "AXWindowCreated".into(),
            pid: 900,
            element: 9_001,
            window: None,
        },
    ));
    let mut ax = MacAx::new(fake);
    assert_eq!(
        ax.notifications().expect("surface").len(),
        1,
        "armed on the first read"
    );
    assert_eq!(
        ax.server().observed,
        vec![900],
        "the settle's own registration"
    );
    assert_eq!(
        ax.wait_event(60),
        Ok(None),
        "a banner event is the surface's, not a window's"
    );
    let banners = ax.notifications().expect("surface");
    assert_eq!(banners.len(), 1);
    let banner = &banners[0];
    assert_eq!(
        (banner.app.as_str(), banner.title.as_str()),
        ("Mail", "New message")
    );
    assert_eq!(banner.body_hash, body_hash(&["Hello there"]));
    assert_eq!(banner.body_hash.len(), 32, "sha256_16");
    assert_eq!(banner.arrived_at_ms, 40, "the AXWindowCreated time");
}
