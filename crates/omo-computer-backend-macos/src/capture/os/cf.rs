//! The CoreFoundation and CoreGraphics calls the macOS seam makes, declared once, with the
//! owned-reference guard and the dictionary readers. Shared with the AX side (row 43).

use std::ffi::{c_char, c_void, CStr};

pub type CfRef = *const c_void;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CgPoint {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CgSize {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CgRect {
    pub origin: CgPoint,
    pub size: CgSize,
}

pub const NUMBER_SINT64: i32 = 4;
pub const STRING_UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub fn CFRelease(value: CfRef);
    pub fn CFEqual(a: CfRef, b: CfRef) -> bool;
    pub fn CFArrayGetCount(array: CfRef) -> isize;
    pub fn CFArrayGetValueAtIndex(array: CfRef, index: isize) -> CfRef;
    pub fn CFDictionaryGetValue(dictionary: CfRef, key: CfRef) -> CfRef;
    pub fn CFNumberGetValue(number: CfRef, kind: i32, out: *mut c_void) -> bool;
    pub fn CFBooleanGetValue(boolean: CfRef) -> bool;
    pub fn CFGetTypeID(value: CfRef) -> usize;
    pub fn CFStringGetTypeID() -> usize;
    pub fn CFStringGetLength(string: CfRef) -> isize;
    pub fn CFStringGetCString(
        string: CfRef,
        buffer: *mut c_char,
        size: isize,
        encoding: u32,
    ) -> bool;
    pub fn CFStringCreateWithCString(allocator: CfRef, text: *const c_char, encoding: u32)
        -> CfRef;
    pub fn CFURLCreateFromFileSystemRepresentation(
        allocator: CfRef,
        path: *const u8,
        length: isize,
        directory: bool,
    ) -> CfRef;
    pub fn CFBundleCreate(allocator: CfRef, url: CfRef) -> CfRef;
    pub fn CFBundleGetIdentifier(bundle: CfRef) -> CfRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    pub fn CGRectMakeWithDictionaryRepresentation(dictionary: CfRef, rect: *mut CgRect) -> bool;
}

/// An owned (+1) CoreFoundation reference, released on drop.
pub struct Owned(CfRef);

impl Owned {
    /// Takes ownership of a reference from a Copy/Create call; `None` for null.
    pub fn new(value: CfRef) -> Option<Self> {
        (!value.is_null()).then_some(Self(value))
    }

    pub const fn get(&self) -> CfRef {
        self.0
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: `self.0` is a non-null +1 reference this guard owns.
        unsafe { CFRelease(self.0) };
    }
}

/// A CFString made from a Rust string (for attribute names).
pub fn cf_string(text: &CStr) -> Option<Owned> {
    // SAFETY: a valid NUL-terminated string and the default allocator.
    Owned::new(unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), STRING_UTF8) })
}

/// The UTF-8 text of a CFString; `None` for null or a non-string.
pub fn string(value: CfRef) -> Option<String> {
    // SAFETY: `value` is a live CF reference owned by its container for this call.
    if value.is_null() || unsafe { CFGetTypeID(value) != CFStringGetTypeID() } {
        return None;
    }
    // SAFETY: `value` is a CFString (checked above) owned by its container for this call.
    let length = unsafe { CFStringGetLength(value) };
    let size = length.checked_mul(4)?.checked_add(1)?;
    let mut buffer = vec![0u8; usize::try_from(size).ok()?];
    // SAFETY: the buffer is `size` bytes long.
    let ok = unsafe { CFStringGetCString(value, buffer.as_mut_ptr().cast(), size, STRING_UTF8) };
    if !ok {
        return None;
    }
    CStr::from_bytes_until_nul(&buffer)
        .ok()
        .map(|s| s.to_string_lossy().into_owned())
}

/// An integer CFNumber; `None` for null.
pub fn int(value: CfRef) -> Option<i64> {
    if value.is_null() {
        return None;
    }
    let mut out: i64 = 0;
    // SAFETY: `value` is a CFNumber and `out` an i64.
    unsafe { CFNumberGetValue(value, NUMBER_SINT64, (&raw mut out).cast()) }.then_some(out)
}

/// A CFBoolean; `false` for null.
pub fn boolean(value: CfRef) -> bool {
    // SAFETY: `value` is a CFBoolean when non-null.
    !value.is_null() && unsafe { CFBooleanGetValue(value) }
}

/// The value under `key` in a CFDictionary.
pub fn get(dictionary: CfRef, key: CfRef) -> CfRef {
    // SAFETY: both are valid CF references for the duration of the call.
    unsafe { CFDictionaryGetValue(dictionary, key) }
}

/// A rect dictionary (`kCGWindowBounds`).
pub fn rect(dictionary: CfRef) -> Option<CgRect> {
    if dictionary.is_null() {
        return None;
    }
    let mut out = CgRect::default();
    // SAFETY: `dictionary` is a CGRect dictionary representation.
    unsafe { CGRectMakeWithDictionaryRepresentation(dictionary, &raw mut out) }.then_some(out)
}
