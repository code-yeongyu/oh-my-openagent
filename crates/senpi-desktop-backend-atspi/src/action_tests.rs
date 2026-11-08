//! Unit tests for the mutating calls - actions, text/value, focus - asserting
//! exactly which round trips reached the bus.

use atspi::{Interface, Role};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::error::ErrorCode;

use crate::fake::{editor, node, FakeNode};
use crate::AtSpiAx;

#[test]
fn press_invokes_the_default_action_not_the_literal_press() {
    let mut ax = AtSpiAx::with_bus(editor());
    ax.perform(&node(11), "press").unwrap();
    assert_eq!(ax.bus.calls, ["action 11 #0"]);
}

#[test]
fn a_named_action_is_matched_ignoring_case() {
    let mut ax = AtSpiAx::with_bus(editor());
    ax.perform(&node(11), "RELEASE").unwrap();
    assert_eq!(ax.bus.calls, ["action 11 #2"]);
}

#[test]
fn an_unlisted_action_is_ax_failed_without_a_call() {
    let mut ax = AtSpiAx::with_bus(editor());
    let error = ax.perform(&node(11), "expand").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(ax.bus.calls.is_empty());
    let empty = ax.perform(&node(12), "press").unwrap_err();
    assert_eq!(empty.code, ErrorCode::AxFailed);
}

#[test]
fn a_refused_action_is_ax_failed() {
    let mut bus = editor();
    bus.nodes.get_mut(&11).unwrap().action_succeeds = false;
    let error = AtSpiAx::with_bus(bus).perform(&node(11), "click").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn set_value_writes_editable_text() {
    let mut ax = AtSpiAx::with_bus(editor());
    ax.set_value(&node(12), "world").unwrap();
    assert_eq!(ax.bus.calls, ["text 12 world"]);
}

#[test]
fn set_value_on_a_value_only_element_sets_the_number() {
    let mut bus = editor();
    let mut slider = FakeNode::new(Role::Slider, "Volume");
    slider.interfaces.insert(Interface::Value);
    bus.add(17, 10, slider);
    let mut ax = AtSpiAx::with_bus(bus);
    ax.set_value(&node(17), " 0.5 ").unwrap();
    assert_eq!(ax.bus.calls, ["value 17 0.5"]);
    let error = ax.set_value(&node(17), "loud").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn set_value_without_text_or_value_is_ax_failed_without_a_call() {
    let mut ax = AtSpiAx::with_bus(editor());
    let error = ax.set_value(&node(11), "1").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(ax.bus.calls.is_empty());
}

#[test]
fn a_rejected_focus_request_is_ax_failed() {
    let mut bus = editor();
    bus.nodes.get_mut(&12).unwrap().focus_accepted = false;
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(ax.focus(&node(12)).unwrap_err().code, ErrorCode::AxFailed);
    assert_eq!(ax.bus.calls, ["focus 12"]);
}
