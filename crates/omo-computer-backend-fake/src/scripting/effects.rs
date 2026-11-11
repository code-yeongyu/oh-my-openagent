//! Scripted effects: each one that reaches the desktop is one sink line, and a refused one is
//! none.

use omo_computer_core::backend::{BackendResult, Refusal, RefusalCode};
use omo_computer_core::listing::Rect;

use crate::backend::FakeBackend;
use crate::method::FakeMethod;
use crate::scenario::{FocusRecordKind, FocusRecordOutcome, FrameAxis};
use crate::sink::quoted;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardRead {
    Text(Option<String>),
    /// The OS marks the content concealed; its text is not read.
    Concealed,
}

/// What the window manager applied for a frame request.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameResult {
    pub frame: Rect,
    /// Axes the window kept against the request.
    pub kept: Vec<FrameAxis>,
    /// The position cannot be set at all.
    pub immovable: bool,
}

fn apply(axis: FrameAxis, frame: &mut Rect, asked: Rect) {
    match axis {
        FrameAxis::X => frame.x = asked.x,
        FrameAxis::Y => frame.y = asked.y,
        FrameAxis::Width => frame.width = asked.width,
        FrameAxis::Height => frame.height = asked.height,
    }
}

impl FakeBackend {
    /// Records a focus change of `kind` on `window`; its outcome follows the scripted list,
    /// and once that runs out the record takes effect.
    ///
    /// # Errors
    /// A scripted fault of `focus_record`.
    pub fn focus_record(
        &mut self,
        kind: FocusRecordKind,
        window: &str,
    ) -> BackendResult<FocusRecordOutcome> {
        self.call(FakeMethod::FocusRecord, |state, _| {
            let position = state.focus_record_pos.get(&kind).copied().unwrap_or(0);
            let scripted = state
                .scenario
                .focus_record_effects
                .get(&kind)
                .and_then(|list| list.get(position));
            let outcome = scripted.copied().unwrap_or(FocusRecordOutcome::TookEffect);
            state.focus_record_pos.insert(kind, position + 1);
            self.sink.record(
                format!("focus_record kind={kind:?} window={window} outcome={outcome:?}")
                    .to_lowercase(),
            );
            Ok(outcome)
        })
    }

    /// # Errors
    /// A scripted fault of `clipboard_read`.
    pub fn clipboard_read(&mut self) -> BackendResult<ClipboardRead> {
        self.call(FakeMethod::ClipboardRead, |state, _| {
            let concealed = state
                .scenario
                .clipboard
                .as_ref()
                .is_some_and(|clip| clip.concealed);
            Ok(if concealed {
                ClipboardRead::Concealed
            } else {
                ClipboardRead::Text(state.clipboard.clone())
            })
        })
    }

    /// # Errors
    /// A scripted fault of `clipboard_write`.
    pub fn clipboard_write(&mut self, text: &str) -> BackendResult<()> {
        self.call(FakeMethod::ClipboardWrite, |state, _| {
            state.clipboard = Some(text.to_owned());
            self.sink
                .record(format!("clipboard_write text={}", quoted(text)));
            Ok(())
        })
    }

    /// Asks the window manager for `frame`; the window's policy decides what sticks.
    ///
    /// # Errors
    /// The window is not listed or has exited, or a scripted fault of `set_frame`.
    pub fn set_frame(&mut self, window: &str, frame: Rect) -> BackendResult<FrameResult> {
        self.call(FakeMethod::SetFrame, |state, _| {
            let current = state
                .live_window(window)
                .map(crate::scenario::FakeWindow::bounds)
                .ok_or(Refusal::new(RefusalCode::Unavailable, "target_gone"))?;
            let policy = state.scenario.window_frame_policy.get(window);
            let kept: Vec<FrameAxis> = policy.map(|p| p.keep.clone()).unwrap_or_default();
            let immovable = policy.and_then(|p| p.settable) == Some(false);
            let mut applied = current;
            for axis in [
                FrameAxis::X,
                FrameAxis::Y,
                FrameAxis::Width,
                FrameAxis::Height,
            ] {
                let positional = matches!(axis, FrameAxis::X | FrameAxis::Y);
                if !kept.contains(&axis) && !(immovable && positional) {
                    apply(axis, &mut applied, frame);
                }
            }
            if let Some(target) = state.windows.iter_mut().find(|w| w.id == window) {
                (target.x, target.y, target.width, target.height) =
                    (applied.x, applied.y, applied.width, applied.height);
            }
            self.sink.record(format!(
                "set_frame window={window} x={} y={} width={} height={}",
                frame.x, frame.y, frame.width, frame.height
            ));
            Ok(FrameResult {
                frame: applied,
                kept,
                immovable,
            })
        })
    }

    /// Selects a menu item by its title path.
    ///
    /// # Errors
    /// The path names no item, or a scripted fault of `menu_select`.
    pub fn menu_select(&mut self, window: &str, path: &[&str]) -> BackendResult<()> {
        self.call(FakeMethod::MenuSelect, |state, _| {
            let mut level = state
                .scenario
                .menus
                .get(window)
                .map(Vec::as_slice)
                .unwrap_or_default();
            for title in path {
                let item = level
                    .iter()
                    .find(|item| item.title == *title)
                    .ok_or(Refusal::new(
                        RefusalCode::AxUnavailable,
                        "menu_item_not_found",
                    ))?;
                if item.enabled == Some(false) {
                    return Err(Refusal::new(
                        RefusalCode::AxUnavailable,
                        "menu_item_disabled",
                    ));
                }
                level = &item.children;
            }
            let joined: Vec<String> = path.iter().map(|title| quoted(title)).collect();
            self.sink.record(format!(
                "menu_select window={window} path={}",
                joined.join(">")
            ));
            Ok(())
        })
    }

    /// The user presses the stop chord: the live listener's next poll reports it.
    pub fn press_stop_chord(&self) {
        self.lock().stop_pressed = true;
    }

    /// Sends a preview frame to the subscriber; returns whether one is subscribed.
    pub fn publish_preview(&self, frame_id: &str) -> bool {
        let subscribed = self.lock().scenario.preview_subscribed;
        if subscribed {
            self.sink.record(format!("preview frame={frame_id}"));
        }
        subscribed
    }
}
