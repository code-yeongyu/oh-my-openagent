//! The one place this crate calls libxkbcommon, loaded at run time (the engine never links
//! it: a host without the library answers typing unavailable instead of failing to start).
//! Every call goes through the safe [`Native`] type, which owns its context, keymap and state
//! and frees them on drop.

use std::ffi::{c_char, CStr, CString};
use std::ptr::NonNull;
use std::sync::OnceLock;

use xkbcommon_dl::{
    xkb_context, xkb_context_flags, xkb_keymap, xkb_keymap_compile_flags, xkb_keymap_format,
    xkb_state, XkbCommon,
};

type LayoutName = unsafe extern "C" fn(*mut xkb_keymap, u32) -> *const c_char;

/// `xkb_keymap_layout_get_name`, which `xkbcommon-dl`'s table lacks, from the same library.
fn layout_name_fn() -> Option<LayoutName> {
    static LOADED: OnceLock<Option<(libloading::Library, LayoutName)>> = OnceLock::new();
    LOADED
        .get_or_init(|| {
            // SAFETY: loading libxkbcommon runs only its ELF initialisers, which have no
            // preconditions; the library stays loaded for the life of the process (static).
            let library = unsafe { libloading::Library::new("libxkbcommon.so.0") }.ok()?;
            // SAFETY: the symbol's C signature is `const char *(struct xkb_keymap *,
            // xkb_layout_index_t)`, which `LayoutName` spells exactly.
            let symbol =
                unsafe { library.get::<LayoutName>(b"xkb_keymap_layout_get_name\0") }.ok()?;
            let function = *symbol;
            Some((library, function))
        })
        .as_ref()
        .map(|(_, function)| *function)
}

/// A compiled keymap and a state over it.
pub struct Native {
    lib: &'static XkbCommon,
    context: NonNull<xkb_context>,
    keymap: NonNull<xkb_keymap>,
    state: NonNull<xkb_state>,
}

// SAFETY: libxkbcommon objects carry no thread affinity; `Native` owns its three objects
// exclusively (no reference-counted copy is handed out), so moving it to another thread moves
// every reference to them. It is not `Sync`.
unsafe impl Send for Native {}

impl Native {
    /// Compiles `text` (XKB keymap text v1, as libei hands it over). `None` when the library is
    /// missing or the text does not compile.
    #[must_use]
    pub fn compile(text: &str) -> Option<Self> {
        let lib = xkbcommon_dl::xkbcommon_option()?;
        let source = CString::new(text.trim_end_matches('\0')).ok()?;
        // SAFETY: a fresh context with no flags; null is checked below.
        let context = NonNull::new(unsafe {
            (lib.xkb_context_new)(xkb_context_flags::XKB_CONTEXT_NO_FLAGS)
        })?;
        // SAFETY: `context` is live; `source` is a NUL-terminated string that outlives the call.
        let keymap = unsafe {
            (lib.xkb_keymap_new_from_string)(
                context.as_ptr(),
                source.as_ptr(),
                xkb_keymap_format::XKB_KEYMAP_FORMAT_TEXT_V1,
                xkb_keymap_compile_flags::XKB_KEYMAP_COMPILE_NO_FLAGS,
            )
        };
        let Some(keymap) = NonNull::new(keymap) else {
            // SAFETY: `context` is live and owned here; this is its only reference.
            unsafe { (lib.xkb_context_unref)(context.as_ptr()) };
            return None;
        };
        // SAFETY: `keymap` is live.
        let state = NonNull::new(unsafe { (lib.xkb_state_new)(keymap.as_ptr()) });
        let Some(state) = state else {
            // SAFETY: both are live and owned here.
            unsafe {
                (lib.xkb_keymap_unref)(keymap.as_ptr());
                (lib.xkb_context_unref)(context.as_ptr());
            }
            return None;
        };
        Some(Self {
            lib,
            context,
            keymap,
            state,
        })
    }

    /// The keymap's layout (group) names, in group order.
    #[must_use]
    pub fn layouts(&self) -> Vec<String> {
        // SAFETY: `keymap` is live for `self`'s lifetime.
        let count = unsafe { (self.lib.xkb_keymap_num_layouts)(self.keymap.as_ptr()) };
        let Some(name) = layout_name_fn() else {
            return (0..count)
                .map(|index| format!("group {}", index + 1))
                .collect();
        };
        (0..count)
            .map(|index| {
                // SAFETY: `keymap` is live and `index < count`; the result is null or a
                // NUL-terminated string owned by the keymap, copied out before return.
                let raw = unsafe { name(self.keymap.as_ptr(), index) };
                if raw.is_null() {
                    return format!("group {}", index + 1);
                }
                // SAFETY: non-null, NUL-terminated, valid while the keymap lives (it does).
                unsafe { CStr::from_ptr(raw) }
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }

    /// The keycode range, inclusive.
    #[must_use]
    pub fn keycodes(&self) -> std::ops::RangeInclusive<u32> {
        // SAFETY: `keymap` is live.
        let (low, high) = unsafe {
            (
                (self.lib.xkb_keymap_min_keycode)(self.keymap.as_ptr()),
                (self.lib.xkb_keymap_max_keycode)(self.keymap.as_ptr()),
            )
        };
        low..=high
    }

    /// The modifier mask bit of the named modifier (`"Shift"`, `"Mod5"`), `None` if absent.
    #[must_use]
    pub fn mod_mask(&self, name: &str) -> Option<u32> {
        let name = CString::new(name).ok()?;
        // SAFETY: `keymap` is live; `name` is NUL-terminated and outlives the call.
        let index =
            unsafe { (self.lib.xkb_keymap_mod_get_index)(self.keymap.as_ptr(), name.as_ptr()) };
        (index < 32).then(|| 1_u32 << index)
    }

    /// Sets the state to `mods` depressed in `group` (locked), nothing latched.
    pub fn set(&mut self, mods: u32, group: u32) {
        // SAFETY: `state` is live and exclusively borrowed through `&mut self`.
        unsafe { (self.lib.xkb_state_update_mask)(self.state.as_ptr(), mods, 0, 0, 0, 0, group) };
    }

    /// The keysym `keycode` produces in the current state.
    #[must_use]
    pub fn keysym(&self, keycode: u32) -> u32 {
        // SAFETY: `state` is live; an out-of-range keycode answers `NoSymbol`.
        unsafe { (self.lib.xkb_state_key_get_one_sym)(self.state.as_ptr(), keycode) }
    }
}

impl Drop for Native {
    fn drop(&mut self) {
        // SAFETY: the three objects are live and owned only by `self`; freed once, in reverse
        // order of creation.
        unsafe {
            (self.lib.xkb_state_unref)(self.state.as_ptr());
            (self.lib.xkb_keymap_unref)(self.keymap.as_ptr());
            (self.lib.xkb_context_unref)(self.context.as_ptr());
        }
    }
}
