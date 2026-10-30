//! The fake's element typing (`ax.typeText`).

use senpi_desktop_core::ax::AxHandle;
use senpi_desktop_core::backend::{DeliveryMode, ElementDelivery, KeyboardFocus};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::protocol_results::AxInputMethod;

use crate::ax_tree::node_id;
use crate::fake::FakeBackend;
use crate::method::{AxWrite, FakeMethod};
use crate::sink::SinkOp;

/// Empty text is done before any write, as on macOS. A native text field
/// (`AXTextField`, `AXTextArea`, `AXComboBox`) takes the text appended to its
/// value in one insertion write, which an `ax_cannot_complete` fault leaves
/// unanswered after it landed; any other element is focused first, then takes
/// the text as keys, one scalar per `check_stop`. A scripted `refuse_focus`
/// (`Faults::refuse_focus_next`) makes the element never take focus: nothing
/// is typed and the delivery reports where the focus stayed.
pub(crate) fn ax_type_text(
    backend: &mut FakeBackend,
    h: &AxHandle,
    text: &str,
    mode: DeliveryMode,
    check_stop: &dyn Fn() -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<ElementDelivery> {
    let node = node_id(h)?;
    if text.is_empty() {
        return Ok(ElementDelivery::Delivered(AxInputMethod::Inserted));
    }
    let native_role = backend.ax_tree.props(node)?.native_role;
    let inserts = matches!(native_role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox");
    if inserts {
        if backend.faults().take_refused_focus() {
            return Err(DesktopError::ax_failed(
                "a refuse_focus fault was armed for an element that takes inserted text; the fault was \
                 consumed and nothing was written (insertion never takes focus)",
            ));
        }
        let reply = backend.begin_write(AxWrite::AxTypeText)?;
        backend.ax_tree.insert_text(node, text)?;
        backend.record(SinkOp::AxTypeText {
            node,
            text: text.to_owned(),
            method: AxInputMethod::Inserted,
            mode,
        });
        reply.confirm("inserting the text")?;
        for _ in text.chars() {
            delivered();
        }
        return Ok(ElementDelivery::Delivered(AxInputMethod::Inserted));
    }
    backend.begin(FakeMethod::AxTypeText)?;
    if backend.faults().take_refused_focus() {
        // The app kept its focus where it was: the window of the focused
        // element, and that element.
        let focused = backend.ax_tree.focused();
        let window = match focused {
            Some(id) => backend.ax_tree.window_of(id)?,
            None => None,
        };
        return Ok(ElementDelivery::Unfocused(KeyboardFocus {
            window,
            element: focused.map(AxHandle::Id),
        }));
    }
    backend.ax_tree.focus(node)?;
    backend.record(SinkOp::AxFocus { node });
    let mut typed = String::new();
    for character in text.chars() {
        check_stop()?;
        typed.push(character);
        backend.ax_tree.insert_text(node, &character.to_string())?;
        delivered();
    }
    backend.record(SinkOp::AxTypeText {
        node,
        text: typed,
        method: AxInputMethod::Keys,
        mode,
    });
    Ok(ElementDelivery::Delivered(AxInputMethod::Keys))
}
