//! Live AX-owner checks against Xvfb + xfwm4 + AT-SPI with the GTK owner
//! fixture: one process, window A overlapping window B's button.

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxOwner};
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopWindow, DisplaySelector, Target};

use crate::X11Backend;

fn fixture_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("precondition: {name} is set"))
}

fn find_named(ax: &mut dyn AxBackend, node: AxHandle, name: &str, depth: u8) -> Option<AxHandle> {
    if ax.props(&node).ok()?.title.as_deref() == Some(name) {
        return Some(node);
    }
    if depth == 16 {
        return None;
    }
    ax.children(&node)
        .ok()?
        .into_iter()
        .find_map(|child| find_named(ax, child, name, depth + 1))
}

fn contains(window: &DesktopWindow, (x, y): (f64, f64)) -> bool {
    let (left, top) = (f64::from(window.x), f64::from(window.y));
    (left..left + f64::from(window.width)).contains(&x) && (top..top + f64::from(window.height)).contains(&y)
}

/// The owner and centre of the button named `button` in the window titled
/// `title`, with the first listed window containing that centre.
fn resolve(backend: &mut X11Backend, title: &str, button: &str) -> (AxOwner, (f64, f64), Option<String>) {
    let windows = backend.windows().unwrap();
    let window = windows
        .iter()
        .find(|window| window.title == title)
        .unwrap_or_else(|| panic!("precondition: '{title}' is listed in {windows:?}"));
    let ax = backend.ax().expect("precondition: AT-SPI bus");
    let root = ax.window_root(window).unwrap();
    let element = find_named(ax, root, button, 0).unwrap_or_else(|| panic!("'{button}' under '{title}'"));
    let bounds = ax.props(&element).unwrap().bounds.expect("button bounds");
    let centre = (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0);
    let owner = ax.owner(&element, &windows).unwrap();
    let geometric = windows
        .iter()
        .find(|window| contains(window, centre))
        .map(|window| window.id.clone());
    println!(
        "windows={:?}",
        windows
            .iter()
            .map(|w| (&w.id, &w.title, w.pid, w.x, w.y, w.width, w.height))
            .collect::<Vec<_>>()
    );
    println!("element='{button}' centre={centre:?} owner={owner:?} first_containing={geometric:?}");
    (owner, centre, geometric)
}

#[test]
#[ignore = "live: needs Xvfb + xfwm4 + AT-SPI + the GTK owner fixture"]
fn ax_click_on_an_overlapped_windows_element_lands_in_that_window() {
    let (title, button) = (fixture_env("SENPI_AX_OWNER_TITLE"), fixture_env("SENPI_AX_OWNER_BUTTON"));
    let mut backend = X11Backend::new(DisplaySelector::All).unwrap();
    let (owner, centre, _) = resolve(&mut backend, &title, &button);
    let expected = backend
        .windows()
        .unwrap()
        .into_iter()
        .find(|window| window.title == title)
        .expect("window still listed");
    assert_eq!(owner, AxOwner::Window(expected.id.clone()));
    assert!(contains(&expected, centre), "centre inside its owner");
    let click = PointerEvent::Click {
        x: centre.0,
        y: centre.1,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    backend
        .pointer(
            &Target::Window(expected.id),
            click,
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();
}

#[test]
#[ignore = "live: needs Xvfb + xfwm4 + AT-SPI + the GTK same-title fixture"]
fn ax_owner_of_indistinguishable_same_process_windows_is_unknown() {
    let (title, button) = (fixture_env("SENPI_AX_OWNER_TITLE"), fixture_env("SENPI_AX_OWNER_BUTTON"));
    let mut backend = X11Backend::new(DisplaySelector::All).unwrap();
    let (owner, _, _) = resolve(&mut backend, &title, &button);
    assert_eq!(owner, AxOwner::Unknown);
}
