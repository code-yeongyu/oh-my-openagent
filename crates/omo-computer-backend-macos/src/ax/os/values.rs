//! Reading one `AXUIElementCopyMultipleAttributeValues` answer into [`Attributes`], and the
//! CoreFoundation values the server writes.

use std::ffi::CStr;

use omo_computer_core::listing::Rect;

use super::ffi::{self, CfRange};
use crate::ax::seam::{Attributes, AxValue};
use crate::capture::os::cf::{self, cf_string, CfRef, CgPoint, CgSize, Owned};

/// The attribute set of one node read, in this order (one IPC).
pub const READ_SET: [&CStr; 15] = [
    c"AXRole",
    c"AXSubrole",
    c"AXTitle",
    c"AXDescription",
    c"AXValue",
    c"AXIdentifier",
    c"AXEnabled",
    c"AXFocused",
    c"AXSelected",
    c"AXExpanded",
    c"AXPosition",
    c"AXSize",
    c"AXElementBusy",
    c"AXLoaded",
    c"AXChildren",
];

/// The attribute names as one CFArray of CFStrings.
pub fn read_set() -> Option<Owned> {
    let names: Vec<Owned> = READ_SET
        .iter()
        .map(|n| cf_string(n))
        .collect::<Option<_>>()?;
    let raw: Vec<CfRef> = names.iter().map(Owned::get).collect();
    // SAFETY: `raw` holds valid CFStrings; the array retains them with the CFType callbacks.
    Owned::new(unsafe {
        ffi::CFArrayCreate(
            std::ptr::null(),
            raw.as_ptr(),
            isize::try_from(raw.len()).ok()?,
            std::ptr::addr_of!(ffi::kCFTypeArrayCallBacks),
        )
    })
}

fn type_of(value: CfRef) -> Option<usize> {
    // SAFETY: a non-null CF value.
    (!value.is_null()).then(|| unsafe { ffi::CFGetTypeID(value) })
}

/// A missing attribute arrives as an AXValue of the error kind.
fn present(value: CfRef) -> Option<CfRef> {
    // SAFETY: plain type-id reads on a non-null value.
    let error = type_of(value)? == unsafe { ffi::AXValueGetTypeID() }
        && unsafe { ffi::AXValueGetType(value) } == ffi::VALUE_AXERROR;
    (!error).then_some(value)
}

fn text(value: CfRef) -> Option<String> {
    let value = present(value)?;
    let kind = type_of(value)?;
    // SAFETY: plain type-id reads.
    let (string, number, boolean) = unsafe {
        (
            ffi::CFStringGetTypeID(),
            ffi::CFNumberGetTypeID(),
            ffi::CFBooleanGetTypeID(),
        )
    };
    if kind == string {
        cf::string(value)
    } else if kind == number {
        cf::int(value).map(|n| n.to_string())
    } else if kind == boolean {
        Some(if cf::boolean(value) { "1" } else { "0" }.to_owned())
    } else {
        None
    }
}

fn flag(value: CfRef) -> Option<bool> {
    let value = present(value)?;
    // SAFETY: plain type-id read.
    (type_of(value)? == unsafe { ffi::CFBooleanGetTypeID() }).then(|| cf::boolean(value))
}

fn ax_value<T: Default>(value: CfRef, kind: u32) -> Option<T> {
    let value = present(value)?;
    let mut out = T::default();
    // SAFETY: `out` matches `kind`'s layout.
    unsafe { ffi::AXValueGetValue(value, kind, (&raw mut out).cast()) }.then_some(out)
}

/// The node behind one read's value array (in [`READ_SET`] order); `None` when the array does
/// not hold one value per name.
pub fn attributes(values: CfRef) -> Option<Attributes> {
    // SAFETY: plain type-id reads on the non-null value the read returned.
    let array = unsafe { ffi::CFGetTypeID(values) == ffi::CFArrayGetTypeID() };
    if !array {
        return None;
    }
    // SAFETY: `values` is a CFArray (checked above).
    let count = unsafe { cf::CFArrayGetCount(values) };
    if usize::try_from(count).unwrap_or(0) < READ_SET.len() {
        return None;
    }
    // SAFETY: `values` is a CFArray with one entry per name (checked above); `i` < its count.
    let at = |i: isize| unsafe { cf::CFArrayGetValueAtIndex(values, i) };
    let point: Option<CgPoint> = ax_value(at(10), ffi::VALUE_CGPOINT);
    let size: Option<CgSize> = ax_value(at(11), ffi::VALUE_CGSIZE);
    let children = present(at(14))
        // SAFETY: a plain type-id read.
        .filter(|c| type_of(*c) == Some(unsafe { ffi::CFArrayGetTypeID() }));
    // SAFETY: `children` is a CFArray.
    let child_count = children.map_or(0, |c| unsafe { cf::CFArrayGetCount(c) });
    let role = text(at(0)).unwrap_or_default();
    let value = text(at(4));
    let indeterminate = (role == "AXProgressIndicator").then_some(value.is_none());
    Some(Attributes {
        subrole: text(at(1)),
        title: text(at(2)),
        description: text(at(3)),
        identifier: text(at(5)),
        enabled: flag(at(6)),
        focused: flag(at(7)),
        selected: flag(at(8)),
        expanded: flag(at(9)),
        frame: point.zip(size).map(|(p, s)| Rect {
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
        }),
        child_count: u32::try_from(child_count).unwrap_or(0),
        busy: flag(at(12)),
        loaded: flag(at(13)),
        actions: Vec::new(),
        role,
        value,
        indeterminate,
    })
}

/// The strings of a CFArray of CFStrings (action names); a non-array reads as none.
pub fn strings(array: CfRef) -> Vec<String> {
    // SAFETY: a plain type-id read.
    let array_type = unsafe { ffi::CFArrayGetTypeID() };
    if type_of(array) != Some(array_type) {
        return Vec::new();
    }
    // SAFETY: `array` is a CFArray (checked above).
    let count = unsafe { cf::CFArrayGetCount(array) };
    (0..count)
        // SAFETY: `i` is in bounds; `cf::string` checks each value is a CFString.
        .filter_map(|i| cf::string(unsafe { cf::CFArrayGetValueAtIndex(array, i) }))
        .collect()
}

/// The CF value an attribute write carries.
pub fn value(value: &AxValue) -> Option<Owned> {
    match value {
        AxValue::Text(text) => cf_string(&std::ffi::CString::new(text.as_str()).ok()?),
        // SAFETY: the CFBoolean constants live for the process; retained for the guard.
        AxValue::Bool(on) => Owned::new(unsafe {
            ffi::CFRetain(if *on {
                ffi::kCFBooleanTrue
            } else {
                ffi::kCFBooleanFalse
            })
        }),
        AxValue::Range { location, length } => {
            let range = CfRange {
                location: isize::try_from(*location).ok()?,
                length: isize::try_from(*length).ok()?,
            };
            // SAFETY: `range` matches the CFRange kind.
            Owned::new(unsafe { ffi::AXValueCreate(ffi::VALUE_CFRANGE, (&raw const range).cast()) })
        }
    }
}
