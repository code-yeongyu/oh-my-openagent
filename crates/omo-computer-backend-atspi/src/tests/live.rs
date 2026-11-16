//! Live legs on a real accessibility bus: run under `dbus-run-session -- xvfb-run` with
//! `--ignored` (a private session bus and a virtual display; never the host's). The GTK4
//! fixture is pressed through AT-SPI and its label read back; its menu item is selected by its
//! exact label. Every wait is on the bus's events, never a sleep.

use std::process::{Child, Command};

use omo_computer_core::backend::{Ref, Semantic};
use omo_computer_core::error::EngineCode;

use super::observe;
use crate::bus::{Extents, NodeId};
use crate::owner::NativeWindow;
use crate::{AtspiBackend, LiveBus};

const GTK4_PRESS: (&str, &str) = ("gtk4_press.py", "omo-atspi-fixture");
const GTK3_MENU: (&str, &str) = ("gtk3_menu.py", "omo-atspi-menu-fixture");
const DEADLINE_MS: u64 = 20_000;

struct Fixture(Child);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start((script, title): (&str, &str)) -> (AtspiBackend<LiveBus>, Fixture) {
    let bus = LiveBus::connect().expect("an accessibility bus (run under dbus-run-session)");
    let mut probe = AtspiBackend::new(Some(bus), Box::new(Vec::new()));
    assert!(
        !probe.open_session().write_refused,
        "IsEnabled is readable and writable"
    );
    drop(probe);
    let path = format!("{}/fixtures/{script}", env!("CARGO_MANIFEST_DIR"));
    let child = Command::new("python3")
        .arg(path)
        .spawn()
        .expect("python3 with GTK bindings");
    let pid = child.id();
    let window = NativeWindow {
        id: "fixture".to_owned(),
        pid: Some(pid),
        app: "python3".to_owned(),
        title: title.to_owned(),
        bounds: Extents {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        },
    };
    let bus = LiveBus::connect().expect("bus");
    let mut backend = AtspiBackend::new(Some(bus), Box::new(vec![window]));
    assert!(
        backend.wait_for_app(pid, DEADLINE_MS),
        "the fixture reached the bus"
    );
    (backend, Fixture(child))
}

/// Observes until `predicate` holds on the tree, re-reading after each bus event.
fn observe_until(backend: &mut AtspiBackend<LiveBus>, predicate: impl Fn(&str) -> bool) -> String {
    let mut last = String::new();
    for _ in 0..400 {
        match observe(backend, "fixture") {
            Ok(observed) => {
                last = observed.snapshot.tree;
                if predicate(&last) {
                    return last;
                }
            }
            Err(refused) => last = format!("{refused:?}"),
        }
        backend.await_event(500);
    }
    panic!("the tree never matched; last:\n{last}");
}

fn reference(tree: &str, label: &str) -> Ref {
    super::ref_of(tree, label)
}

#[test]
#[ignore = "live: needs dbus-run-session + Xvfb + python3-gi GTK4"]
fn live_gtk4_press_changes_the_label_read_back() {
    let (mut backend, _fixture) = start(GTK4_PRESS);
    let tree = observe_until(&mut backend, |tree| tree.contains("\"Press me\""));

    let delivered =
        backend.perform_detailed(&reference(&tree, "Press me"), &Semantic("press".to_owned()));

    assert!(delivered.is_ok(), "{delivered:?}\n{tree}");
    observe_until(&mut backend, |tree| tree.contains("\"Pressed 1\""));
}

#[test]
#[ignore = "live: needs dbus-run-session + Xvfb + python3-gi GTK3"]
fn live_gtk3_menu_item_selected_by_exact_label() {
    let (mut backend, _fixture) = start(GTK3_MENU);
    observe_until(&mut backend, |tree| tree.contains("\"File\""));

    let selected = backend.select_menu("fixture", &["File", "Mark done"]);

    assert!(selected.is_ok(), "{selected:?}");
    observe_until(&mut backend, |tree| tree.contains("\"Menu: Mark done\""));
}

#[test]
#[ignore = "live: needs dbus-run-session + Xvfb"]
fn live_app_not_on_bus_and_focus_from_events() {
    let bus = LiveBus::connect().expect("bus");
    let absent = NativeWindow {
        id: "0x9".to_owned(),
        pid: Some(1),
        app: "init".to_owned(),
        title: "none".to_owned(),
        bounds: Extents {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        },
    };
    let mut backend = AtspiBackend::new(Some(bus), Box::new(vec![absent]));

    let refused = observe(&mut backend, "0x9").expect_err("pid 1 is not on the bus");

    assert_eq!(refused.code(), EngineCode::AxUnsupported);
    assert_eq!(backend.focused().expect("a bus"), None::<NodeId>);
}
