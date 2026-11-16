//! The Windows reads and the one post a background delivery makes, behind a seam so every rule
//! runs on every OS. The posted route's window for keys and text is the target thread's focus
//! window when it is the addressed window or one of its descendants (a focus in another top-level
//! window of the same thread, such as a dialog, is never posted to), else the SOLE visible, enabled
//! descendant that wants characters (`DLGC_WANTCHARS`) of an ENABLED addressed window (an owner a
//! modal dialog disabled takes no real input); two candidates or none refuse `no_focus_target` with
//! nothing sent.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

use crate::barrier::PaintOs;
use crate::input::focus_child::{focus_child, FocusOs, NO_FOCUS_TARGET};
use crate::input::Posted;

use super::integrity::Integrity;

/// A point in a window's client area, in the 16-bit range a mouse message carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientPoint {
    pub x: i16,
    pub y: i16,
}

/// Why a post failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostFailure {
    /// UIPI: the target is above the engine (error 5).
    AccessDenied,
    /// Any other failure (a window that died between the read and the post).
    Failed,
}

/// The OS a background delivery reads and posts through.
pub trait DeliveryOs: FocusOs + PaintOs + Send {
    /// `IsWindow`.
    fn alive(&self, window: isize) -> bool;
    /// `GetClassNameW`.
    fn class(&self, window: isize) -> Option<String>;
    /// The integrity RIDs of the window's process and of the engine.
    fn integrity(&self, window: isize) -> Integrity;
    /// Whether `window` is `top` or one of its descendants (`IsChild`): input posted to it lands
    /// in the addressed window.
    fn within(&self, window: isize, top: isize) -> bool;
    /// `IsWindowEnabled`: a window a modal dialog disabled takes no real input.
    fn enabled(&self, window: isize) -> bool;
    /// The visible, enabled descendants answering `WM_GETDLGCODE` with `DLGC_WANTCHARS`.
    fn wants_chars(&self, window: isize) -> Vec<isize>;
    /// The deepest enabled, visible child of `window` under the screen point, with the point in
    /// that child's client coordinates; `None` outside the window or out of the message range.
    fn child_at(&self, window: isize, at: Point) -> Option<(isize, ClientPoint)>;
    /// One `PostMessageW` (the crate's single call site).
    ///
    /// # Errors
    /// The failed post.
    fn post(&mut self, window: isize, message: &Posted) -> Result<(), PostFailure>;
}

/// The refusal of a background route whose window is not a live window.
pub const TARGET_UNKNOWN: Refusal =
    Refusal::new(EngineCode::BackgroundUnavailable, Reason::TargetUnknown);

/// The window a `Route::BackgroundWindow` names: its HWND in decimal or `0x` hex, never 0.
#[must_use]
pub fn window_of(id: &str) -> Option<isize> {
    let parsed = match id.strip_prefix("0x").or_else(|| id.strip_prefix("0X")) {
        Some(hex) => isize::from_str_radix(hex, 16).ok(),
        None => id.parse().ok(),
    };
    parsed.filter(|window| *window != 0)
}

/// A screen or client coordinate rounded to the 16-bit range a message carries.
#[must_use]
pub fn coordinate(value: f64) -> Option<i16> {
    let rounded = value.round();
    // In range by the check, so the cast neither truncates nor saturates.
    (f64::from(i16::MIN)..=f64::from(i16::MAX))
        .contains(&rounded)
        .then_some(rounded as i16)
}

/// The window keys and text are posted to for the top-level `window`.
///
/// # Errors
/// [`NO_FOCUS_TARGET`] with nothing sent.
pub fn key_target(os: &dyn DeliveryOs, window: isize) -> Result<isize, Refusal> {
    match focus_child(os, window) {
        Ok(focus) if os.within(focus, window) => Ok(focus),
        _ if !os.enabled(window) => Err(NO_FOCUS_TARGET),
        _ => match os.wants_chars(window).as_slice() {
            [only] => Ok(*only),
            _ => Err(NO_FOCUS_TARGET),
        },
    }
}
