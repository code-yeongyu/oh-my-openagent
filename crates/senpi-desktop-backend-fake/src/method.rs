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
    KeyChord,
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
    AxElementAt,
    AxFocusedElement,
    AxAttributes,
}
