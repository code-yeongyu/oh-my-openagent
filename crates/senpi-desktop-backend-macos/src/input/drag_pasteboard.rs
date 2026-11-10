//! The drag pasteboard, which a drag source clears and writes as it begins a
//! drag-and-drop session: its change count is the signal that a background
//! drag picked up an item.

use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};

/// Change count of the drag pasteboard.
pub(super) fn change_count() -> isize {
    // SAFETY: `NSPasteboardNameDrag` is an immutable AppKit string constant.
    NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag }).changeCount()
}
