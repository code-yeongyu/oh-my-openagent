//! Hit-testing over the in-memory proxy shim: the frame holding the point
//! is asked first, then each answer in turn, down to the deepest element.

use atspi::{Interface, Role};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::error::ErrorCode;

use crate::bus::Extents;
use crate::fake::{editor, node, FakeBus, FakeNode};
use crate::AtSpiAx;

const PANEL: Extents = Extents {
    x: 10,
    y: 20,
    width: 640,
    height: 480,
};
const PRESS: Extents = Extents {
    x: 300,
    y: 60,
    width: 80,
    height: 30,
};

/// A component under `parent` that answers hit-tests with `hit`.
fn component(bus: &mut FakeBus, id: u64, parent: u64, role: Role, name: &str, extents: Extents) {
    let mut node = FakeNode::new(role, name);
    node.interfaces.insert(Interface::Component);
    node.extents = Some(extents);
    bus.add(id, parent, node);
}

fn answers(bus: &mut FakeBus, node: u64, hit: u64) {
    bus.nodes.get_mut(&node).unwrap().hit = Some(hit);
}

/// The editor's frame (10) holding a GTK-style untitled root filler (20),
/// a box (21) inside it, and a Press button (22) inside the box: each
/// level answers with its own child under the point, as GTK does.
fn nested() -> FakeBus {
    let mut bus = editor();
    component(&mut bus, 20, 10, Role::Filler, "", PANEL);
    component(&mut bus, 21, 20, Role::Panel, "", PANEL);
    component(&mut bus, 22, 21, Role::Button, "Press", PRESS);
    answers(&mut bus, 10, 20);
    answers(&mut bus, 20, 21);
    answers(&mut bus, 21, 22);
    bus
}

fn hit(ax: &mut AtSpiAx<FakeBus>, x: f64, y: f64) -> Option<u64> {
    ax.element_at(x, y)
        .unwrap()
        .map(|found| *found.downcast_native::<u64>().unwrap())
}

#[test]
fn element_at_descends_past_the_root_filler_to_the_deepest_element() {
    let mut ax = AtSpiAx::with_bus(nested());
    assert_eq!(hit(&mut ax, 340.0, 75.0), Some(22));
    assert_eq!(
        ax.bus.calls,
        ["hit 10 @340,75", "hit 20 @340,75", "hit 21 @340,75", "hit 22 @340,75"]
    );
}

#[test]
fn element_at_stops_at_an_element_without_a_component() {
    let mut bus = nested();
    bus.nodes.get_mut(&22).unwrap().interfaces = FakeNode::new(Role::Button, "").interfaces;
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(hit(&mut ax, 340.0, 75.0), Some(22));
}

#[test]
fn element_at_stops_part_way_down_at_an_element_without_a_component() {
    let mut bus = nested();
    bus.nodes.get_mut(&21).unwrap().interfaces = FakeNode::new(Role::Panel, "").interfaces;
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(hit(&mut ax, 340.0, 75.0), Some(21));
    assert_eq!(ax.bus.calls, ["hit 10 @340,75", "hit 20 @340,75", "hit 21 @340,75"]);
}

#[test]
fn a_failed_round_trip_part_way_down_fails_the_read() {
    let mut bus = nested();
    bus.nodes.get_mut(&21).unwrap().hit_fails = true;
    let error = AtSpiAx::with_bus(bus).element_at(340.0, 75.0).err().unwrap();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("timed out"), "{}", error.message);
}

#[test]
fn element_at_stops_at_an_element_that_answers_with_itself() {
    let mut bus = nested();
    answers(&mut bus, 22, 22);
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(hit(&mut ax, 340.0, 75.0), Some(22));
    assert_eq!(ax.bus.calls.len(), 4);
}

#[test]
fn element_at_is_none_when_the_frame_has_nothing_under_the_point() {
    let mut ax = AtSpiAx::with_bus(editor());
    assert_eq!(hit(&mut ax, 340.0, 75.0), None);
    assert_eq!(ax.bus.calls, ["hit 10 @340,75"]);
}

#[test]
fn same_element_compares_the_bus_objects() {
    let mut ax = AtSpiAx::with_bus(editor());
    assert!(ax.same_element(&node(11), &node(11)));
    assert!(!ax.same_element(&node(11), &node(12)));
}
