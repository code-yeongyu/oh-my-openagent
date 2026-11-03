//! Ignored real Windows probes; queue sentinels prove consumption, not sleeps.

use super::live_window::Window;
use crate::Win32Backend;
use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::types::DisplaySelector;

fn path(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|label| (*label).into()).collect()
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn attached_hmenu_listing_selection_and_refusals() {
    let fixture = Window::new();
    let window = fixture.desktop();
    let mut backend = Win32Backend::new(DisplaySelector::All).unwrap();
    let items = backend.menu_items(&window, &[]).unwrap();
    assert_eq!(
        items
            .iter()
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>(),
        ["File", "Edit"]
    );
    assert!(items.iter().all(|item| item.has_submenu));
    let file = backend.menu_items(&window, &path(&["File"])).unwrap();
    assert_eq!(file[0].title, "Open...");
    assert_eq!(file[0].shortcut.as_deref(), Some("Ctrl+O"));
    assert_eq!(file[0].path, path(&["File", "Open..."]));
    assert_eq!(file[1].title, "Save");
    assert_eq!(file.len(), 5);
    assert!(file.iter().all(|item| !item.title.is_empty()));
    assert_eq!(
        backend
            .menu_items(&window, &path(&["File", "Recent"]))
            .unwrap()[0]
            .title,
        "a.txt"
    );
    assert!(!backend.menu_items(&window, &path(&["Edit"])).unwrap()[0].enabled);
    assert!(backend
        .menu_items(&window, &path(&["File", "Open"]))
        .is_err());
    assert!(fixture.drain().is_empty());

    for labels in [
        vec!["File", "Duplicate"],
        vec!["Edit", "Undo"],
        vec!["File", "Recent"],
        vec!["File"],
        vec!["File", ""],
        vec!["File", "Missing"],
    ] {
        assert!(backend
            .menu_select(
                &window,
                &path(&labels),
                DeliveryMode::Background,
                &|| Ok(())
            )
            .is_err());
        assert!(
            fixture.drain().is_empty(),
            "refused command dispatched: {labels:?}"
        );
    }
    for mode in [DeliveryMode::Background, DeliveryMode::Foreground] {
        backend
            .menu_select(&window, &path(&["file", "open"]), mode, &|| Ok(()))
            .unwrap();
        assert_eq!(fixture.drain(), [101]);
    }
    backend
        .menu_select(
            &window,
            &path(&["File", "Recent", "a.txt"]),
            DeliveryMode::Background,
            &|| Ok(()),
        )
        .unwrap();
    assert_eq!(fixture.drain(), [103]);
    let stop = || {
        Err(senpi_desktop_core::error::DesktopError::ax_failed(
            "stopped",
        ))
    };
    assert!(backend
        .menu_select(
            &window,
            &path(&["File", "Save"]),
            DeliveryMode::Background,
            &stop
        )
        .is_err());
    assert!(fixture.drain().is_empty());
    println!(
        "hmenu_listing=pass normalized_select=pass refusals_no_dispatch=pass exactly_once=pass"
    );
}
