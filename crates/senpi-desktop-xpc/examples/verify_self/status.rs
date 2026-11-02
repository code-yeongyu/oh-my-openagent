//! Independent live-status diagnostics, not an authentication API.
use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString, CFType};
use std::ptr::NonNull;

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    fn SecCodeCopySelf(flags: u32, code: *mut *mut CFType) -> i32;
    fn SecCodeCopySigningInformation(
        code: *const CFType,
        flags: u32,
        info: *mut *mut CFType,
    ) -> i32;
    static kSecCodeInfoStatus: &'static CFString;
}

fn copied(call: impl FnOnce(*mut *mut CFType) -> i32) -> Result<CFRetained<CFType>, &'static str> {
    let mut output = std::ptr::null_mut();
    if call(&mut output) != 0 {
        return Err("Security.framework lookup failed");
    }
    let output = NonNull::new(output).ok_or("null Security.framework output")?;
    // SAFETY: only the Create-rule Security Copy calls below provide a +1 live
    // object to this helper. NonNull rejected a null success result.
    Ok(unsafe { CFRetained::from_raw(output) })
}

pub(super) fn current() -> Result<u32, &'static str> {
    let code = copied(|output| {
        // SAFETY: the initialized, writable out-pointer is provided by copied.
        unsafe { SecCodeCopySelf(0, output) }
    })?;
    let info = copied(|output| {
        // SAFETY: code is a live retained SecCode and output is writable.
        unsafe { SecCodeCopySigningInformation(&*code, 10, output) }
    })?;
    let dict = info
        .downcast_ref::<CFDictionary>()
        .ok_or("not a dictionary")?;
    // SAFETY: Security's dictionary contains CF objects. Each value remains a
    // CFType until its runtime type is checked below.
    let dict = unsafe { &*(std::ptr::from_ref(dict).cast::<CFDictionary<CFType, CFType>>()) };
    // SAFETY: Security exports an immutable nonnull CFString for the live status key.
    let key = unsafe { kSecCodeInfoStatus };
    let value = dict.get(key.as_ref()).ok_or("missing live status")?;
    let number = value
        .downcast_ref::<CFNumber>()
        .ok_or("mistyped live status")?;
    if number.is_float_type() {
        return Err("floating-point live status");
    }
    number
        .as_i64()
        .and_then(|n| u32::try_from(n).ok())
        .ok_or("invalid live status bits")
}
