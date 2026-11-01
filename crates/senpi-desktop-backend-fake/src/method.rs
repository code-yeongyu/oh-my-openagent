use serde::Deserialize;

/// Every fallible fake-backend call a scenario can delay or fail.
///
/// Pointer events are split by kind (`click`, `move`, ...) so a test can fail
/// a click without touching moves. `capabilities()` is infallible and has no
/// variant: it is never delayed or failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FakeMethod {
    Displays,
    Windows,
    Capture,
    Click,
    Move,
    Drag,
    Scroll,
    TypeText,
    ClipboardRead,
    ClipboardWrite,
    KeyChord,
    KeyPress,
    KeyRelease,
    MousePress,
    MouseRelease,
    RaiseWindow,
    ReleaseAll,
    CursorPosition,
    WarpCursor,
    FrontWindow,
    RestoreFrontWindow,
    RestoreKeyFocus,
    ScreenLocked,
    AxWindowRoot,
    AxProps,
    AxChildren,
    AxParent,
    AxPerform,
    AxSetValue,
    AxFocus,
    AxTypeText,
    AxElementAt,
    AxFocusedElement,
    AxAttributes,
    AxOwner,
    MenuItems,
    MenuSelect,
}

/// The AX writes a scenario can leave unanswered (`ax_cannot_complete`):
/// the write lands, but the call reports `AxUnconfirmed`, like a macOS app
/// that got the request and replied `kAXErrorCannotComplete`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AxWrite {
    AxPerform,
    AxSetValue,
    AxFocus,
    /// The insertion write of `ax.typeText` into a native text field.
    AxTypeText,
}

impl AxWrite {
    pub const fn method(self) -> FakeMethod {
        match self {
            Self::AxPerform => FakeMethod::AxPerform,
            Self::AxSetValue => FakeMethod::AxSetValue,
            Self::AxFocus => FakeMethod::AxFocus,
            Self::AxTypeText => FakeMethod::AxTypeText,
        }
    }
}
