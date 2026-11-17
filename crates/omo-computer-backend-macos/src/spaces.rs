//! Spaces: the active Space and a window's Space through the probed SkyLight symbols (ledger
//! rows `copy-spaces`, UNMEASURED; an unresolved symbol reads `None`). Nothing here moves a
//! window to a Space or switches the user's Space: a window on another Space is captured and
//! placed where it is (the source guard below keeps it that way).

/// SkyLight names that move windows or switch Spaces; none may appear in this crate.
pub const FORBIDDEN_SPACE_WRITES: [&str; 3] =
    ["MoveWindowsToManagedSpace", "SetCurrentSpace", "ShowSpaces"];

#[cfg(target_os = "macos")]
mod os {
    use crate::capture::os::cf::{self, CfRef, Owned};
    use crate::capture::os::symbols;

    type MainConnection = unsafe extern "C" fn() -> i32;
    type ActiveSpace = unsafe extern "C" fn(i32) -> u64;
    type CopySpaces = unsafe extern "C" fn(i32, i32, CfRef) -> CfRef;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFNumberCreate(allocator: CfRef, kind: i32, value: *const std::ffi::c_void) -> CfRef;
        fn CFArrayCreate(
            allocator: CfRef,
            values: *const CfRef,
            count: isize,
            callbacks: *const std::ffi::c_void,
        ) -> CfRef;
        static kCFTypeArrayCallBacks: std::ffi::c_void;
    }

    /// The user's current Space id.
    pub fn active_space() -> Option<u64> {
        let connection = symbols::lookup::<MainConnection>(c"SLSMainConnectionID")?;
        let active = symbols::lookup::<ActiveSpace>(c"SLSGetActiveSpace")?;
        // SAFETY: the probed symbols' signatures.
        Some(unsafe { active(connection()) })
    }

    /// The Space of window `number` (all Spaces mask).
    pub fn space_of(number: u32) -> Option<String> {
        let connection = symbols::lookup::<MainConnection>(c"SLSMainConnectionID")?;
        let copy = symbols::lookup::<CopySpaces>(c"SLSCopySpacesForWindows")?;
        let value = i64::from(number);
        // SAFETY: an SInt64 CFNumber of `value`; +1.
        let id = Owned::new(unsafe {
            CFNumberCreate(
                std::ptr::null(),
                cf::NUMBER_SINT64,
                (&raw const value).cast(),
            )
        })?;
        let raw = [id.get()];
        // SAFETY: one CFNumber, retained by the array.
        let windows = Owned::new(unsafe {
            CFArrayCreate(
                std::ptr::null(),
                raw.as_ptr(),
                1,
                std::ptr::addr_of!(kCFTypeArrayCallBacks),
            )
        })?;
        // SAFETY: the probed symbol's signature; mask 7 = every Space kind; +1 CFArray.
        let spaces = Owned::new(unsafe { copy(connection(), 7, windows.get()) })?;
        // The private symbol's answer is checked, not trusted: a CFArray, then a CFNumber.
        // SAFETY: `spaces` is a CFArray (checked first).
        if !cf::is_array(spaces.get()) || unsafe { cf::CFArrayGetCount(spaces.get()) } < 1 {
            return None;
        }
        // SAFETY: index 0 in bounds; `cf::int` type-checks the element.
        cf::int(unsafe { cf::CFArrayGetValueAtIndex(spaces.get(), 0) }).map(|s| s.to_string())
    }
}

#[cfg(target_os = "macos")]
pub use os::{active_space, space_of};

#[cfg(test)]
mod tests {
    #[test]
    fn space_move_never_switches_user_space_source_guard() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).expect("src") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs")
                    && !path.ends_with("spaces.rs")
                {
                    let text = std::fs::read_to_string(&path).expect("read");
                    for name in super::FORBIDDEN_SPACE_WRITES {
                        assert!(!text.contains(name), "{} names {name}", path.display());
                    }
                }
            }
        }
    }
}
