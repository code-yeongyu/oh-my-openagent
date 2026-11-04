//! Private SkyLight SPI resolution: the dlopen/dlsym probe, the typed
//! function-pointer sets, and the `SENPI_DESKTOP_DISABLE_SKYLIGHT` test hook.
//!
//! Nothing here posts events; it only hands back atomically resolved,
//! exact-signature function pointers (see the per-field types).

use std::ffi::{c_void, CStr};
use std::mem;
use std::ptr::NonNull;
use std::sync::LazyLock;

use objc2_core_foundation::{CFArray, CFString};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::psn::ProcessSerialNumber;

pub(super) type SLEventPostToPidFn = unsafe extern "C" fn(libc::pid_t, *mut c_void);
type SLEventSetIntegerValueFieldFn = unsafe extern "C" fn(*mut c_void, u32, i64);
type SLPSPostEventRecordToFn = unsafe extern "C" fn(*const ProcessSerialNumber, *const u8) -> i32;
type SLPSGetFrontProcessFn = unsafe extern "C" fn(*mut ProcessSerialNumber) -> i32;
type CGSMainConnectionIDFn = unsafe extern "C" fn() -> u32;
type SLSGetWindowOwnerFn = unsafe extern "C" fn(u32, u32, *mut u32) -> i32;
type SLSGetConnectionPSNFn = unsafe extern "C" fn(u32, *mut ProcessSerialNumber) -> i32;
type GetProcessForPIDFn = unsafe extern "C" fn(libc::pid_t, *mut ProcessSerialNumber) -> i32;
type GetProcessPIDFn = unsafe extern "C" fn(*const ProcessSerialNumber, *mut libc::pid_t) -> i32;
type CGEventSetWindowLocationFn = unsafe extern "C" fn(*mut c_void, CGPoint);
type SLPSSetFrontProcessWithOptionsFn = unsafe extern "C" fn(*const ProcessSerialNumber, u32, u32) -> i32;
type SLEventSetAuthenticationMessageFn = unsafe extern "C" fn(*mut c_void, *mut c_void);
pub(super) type ObjcGetClassFn = unsafe extern "C" fn(*const std::ffi::c_char) -> *mut c_void;
pub(super) type SelRegisterNameFn = unsafe extern "C" fn(*const std::ffi::c_char) -> *mut c_void;
pub(super) type ClassRespondsToSelectorFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> bool;
pub(super) type AuthenticationFactoryFn = unsafe extern "C" fn(
    *mut c_void,
    *mut c_void,
    *mut c_void,
    std::ffi::c_int,
    std::ffi::c_uint,
) -> *mut c_void;

use core_graphics::geometry::CGPoint;

// Window Space movement (oh-my-pi `desktop/macos/spaces.rs`, MIT). Native ABI
// reference, not a dependency: yabai `src/misc/extern.h`. In particular,
// `SLSMoveWindowsToManagedSpace` returns void, not a CGError.
pub(crate) type SpaceConnectionFn = unsafe extern "C" fn() -> i32;
pub(crate) type ActiveSpaceFn = unsafe extern "C" fn(i32) -> u64;
pub(crate) type CopySpacesForWindowsFn = unsafe extern "C" fn(i32, i32, &CFArray) -> *const CFArray;
pub(crate) type MoveWindowsToSpaceFn = unsafe extern "C" fn(i32, &CFArray, u64);
pub(crate) type SpaceWindowOwnerFn = unsafe extern "C" fn(i32, u32, *mut i32) -> i32;
pub(crate) type ConnectionPidFn = unsafe extern "C" fn(i32, *mut libc::pid_t) -> i32;
pub(crate) type SpaceTypeFn = unsafe extern "C" fn(i32, u64) -> i32;
pub(crate) type CopyManagedDisplaysFn = unsafe extern "C" fn(i32) -> *const CFArray;
pub(crate) type DisplayCurrentSpaceFn = unsafe extern "C" fn(i32, &CFString) -> u64;

/// The SkyLight Space functions `window.bringToCurrentSpace` needs; all or
/// nothing, so a partial set never moves a window it cannot verify.
pub(crate) struct SpaceSpi {
    pub(crate) connection: SpaceConnectionFn,
    pub(crate) active: ActiveSpaceFn,
    pub(crate) copy_spaces: CopySpacesForWindowsFn,
    pub(crate) move_windows: MoveWindowsToSpaceFn,
    pub(crate) window_owner: SpaceWindowOwnerFn,
    pub(crate) connection_pid: ConnectionPidFn,
    pub(crate) space_type: SpaceTypeFn,
    pub(crate) copy_displays: CopyManagedDisplaysFn,
    pub(crate) display_space: DisplayCurrentSpaceFn,
}

/// The SPI needed for every background event post.
pub(super) struct RequiredSpi {
    pub(super) post_to_pid: SLEventPostToPidFn,
    pub(super) set_integer: SLEventSetIntegerValueFieldFn,
    pub(super) post_record: SLPSPostEventRecordToFn,
    pub(super) get_front: SLPSGetFrontProcessFn,
    pub(super) set_window_location: CGEventSetWindowLocationFn,
    pub(super) psn: PsnLookup,
}

/// The SPI needed only for foreground delivery and focus restore.
pub(super) struct ForegroundSpi {
    pub(super) set_front: SLPSSetFrontProcessWithOptionsFn,
    pub(super) psn: PsnLookup,
}

/// The SPI that authenticates background keyboard events on macOS 15+.
pub(super) struct AuthenticationSpi {
    pub(super) set_message: SLEventSetAuthenticationMessageFn,
    pub(super) objc_get_class: ObjcGetClassFn,
    pub(super) sel_register_name: SelRegisterNameFn,
    pub(super) class_responds: ClassRespondsToSelectorFn,
    pub(super) factory: AuthenticationFactoryFn,
}

/// Two interchangeable pid -> PSN routes: the SkyLight connection chain and
/// the legacy HIToolbox `GetProcessForPID`.
#[derive(Clone, Copy)]
pub(super) struct PsnLookup {
    pub(super) main_connection: Option<CGSMainConnectionIDFn>,
    pub(super) get_window_owner: Option<SLSGetWindowOwnerFn>,
    pub(super) get_connection_psn: Option<SLSGetConnectionPSNFn>,
    pub(super) get_process_for_pid: Option<GetProcessForPIDFn>,
}

impl PsnLookup {
    pub(super) const fn can_resolve(self) -> bool {
        (self.main_connection.is_some()
            && self.get_window_owner.is_some()
            && self.get_connection_psn.is_some())
            || self.get_process_for_pid.is_some()
    }
}

static REQUIRED: LazyLock<Option<RequiredSpi>> = LazyLock::new(resolve_required);
static SPACES: LazyLock<Option<SpaceSpi>> = LazyLock::new(|| {
    if disabled_by_env() {
        return None;
    }
    ensure_skylight_loaded()?;
    resolve_spaces(raw_symbol)
});
static FOREGROUND: LazyLock<Option<ForegroundSpi>> = LazyLock::new(resolve_foreground);
pub(super) static AUTHENTICATION: LazyLock<Option<AuthenticationSpi>> = LazyLock::new(resolve_authentication);
static FRONT_PID: LazyLock<Option<(SLPSGetFrontProcessFn, GetProcessPIDFn)>> = LazyLock::new(|| {
    if disabled_by_env() {
        return None;
    }
    ensure_skylight_loaded()?;
    Some((symbol(c"_SLPSGetFrontProcess")?, symbol(c"GetProcessPID")?))
});

/// The front process's pid as WindowServer reports it now. Unlike
/// `NSWorkspace.frontmostApplication`, this does not depend on an AppKit run
/// loop in this process observing activation changes (the engine has none, so
/// the AppKit value can stay at whatever application was front when it was
/// first read).
pub(crate) fn front_pid() -> Option<libc::pid_t> {
    let (get_front, get_pid) = (*FRONT_PID)?;
    let mut psn = ProcessSerialNumber::default();
    // SAFETY: `psn` is a writable 8-byte PSN, the exact record this SPI fills.
    if unsafe { get_front(&mut psn) } != 0 {
        return None;
    }
    let mut pid: libc::pid_t = 0;
    // SAFETY: both pointers are valid for the synchronous lookup and the symbol
    // has the exact `GetProcessPID` ABI.
    (unsafe { get_pid(&psn, &mut pid) } == 0 && pid > 0).then_some(pid)
}

/// Test hook: `SENPI_DESKTOP_DISABLE_SKYLIGHT=1` makes every probe report the
/// SPI as missing so the no-SkyLight failure paths stay exercisable.
fn disabled_by_env() -> bool {
    std::env::var_os("SENPI_DESKTOP_DISABLE_SKYLIGHT").is_some_and(|value| value == "1")
}

/// Pure decision core of [`disabled_by_env`] (unit-tested without touching
/// process-global environment state).
#[cfg(test)]
pub(super) fn env_disables(value: Option<&str>) -> bool {
    value == Some("1")
}

pub(crate) fn required() -> CoreResult<&'static RequiredSpi> {
    REQUIRED.as_ref().ok_or_else(|| {
        DesktopError::background_unavailable(
            "skylight-spi-missing: required SkyLight background input symbols are unavailable; \
             retry with delivery:\"foreground\" or use ax actions",
        )
    })
}

pub(super) fn foreground() -> Option<&'static ForegroundSpi> {
    FOREGROUND.as_ref()
}

/// The Space functions, or `SpaceUnsupported` when this macOS does not export
/// every one of them.
pub(crate) fn spaces() -> CoreResult<&'static SpaceSpi> {
    space_spi_or_unsupported(SPACES.as_ref())
}

/// The Space functions when the full set resolved (`window_on_another_space`
/// treats a missing set as unknown, not as an error).
pub(crate) fn spaces_if_available() -> Option<&'static SpaceSpi> {
    SPACES.as_ref()
}

pub(super) fn space_spi_or_unsupported(spi: Option<&SpaceSpi>) -> CoreResult<&SpaceSpi> {
    spi.ok_or_else(|| {
        DesktopError::space_unsupported(
            "this macOS version does not expose the window Space-movement and verification APIs; \
             move the window manually with Mission Control",
        )
    })
}

/// Resolves the whole Space set through `lookup`; one missing name yields
/// `None`. The connection prefers SkyLight's name and falls back to the
/// CoreGraphics alias, as oh-my-pi does.
pub(super) fn resolve_spaces(lookup: impl Fn(&CStr) -> Option<NonNull<c_void>>) -> Option<SpaceSpi> {
    // A closure cannot be generic, so it would pin every field to the first
    // field's type; this fn takes each field's own fn-pointer type instead.
    fn get<T: Copy>(lookup: &dyn Fn(&CStr) -> Option<NonNull<c_void>>, name: &CStr) -> Option<T> {
        lookup(name).map(|raw| cast_symbol(raw.as_ptr()))
    }
    let lookup: &dyn Fn(&CStr) -> Option<NonNull<c_void>> = &lookup;
    Some(SpaceSpi {
        connection: get(lookup, c"SLSMainConnectionID").or_else(|| get(lookup, c"CGSMainConnectionID"))?,
        active: get(lookup, c"SLSGetActiveSpace").or_else(|| get(lookup, c"CGSGetActiveSpace"))?,
        copy_spaces: get(lookup, c"SLSCopySpacesForWindows")?,
        move_windows: get(lookup, c"SLSMoveWindowsToManagedSpace")?,
        window_owner: get(lookup, c"SLSGetWindowOwner")?,
        connection_pid: get(lookup, c"SLSConnectionGetPID")?,
        space_type: get(lookup, c"SLSSpaceGetType")?,
        copy_displays: get(lookup, c"SLSCopyManagedDisplays")?,
        display_space: get(lookup, c"SLSManagedDisplayGetCurrentSpace")?,
    })
}

/// Whether the SkyLight framework loaded and every required symbol resolved.
pub(crate) fn is_available() -> bool {
    !disabled_by_env() && REQUIRED.is_some()
}

#[cfg(test)]
pub(super) fn skylight_available(disabled: bool, resolved: bool) -> bool {
    !disabled && resolved
}

fn lookup() -> Option<PsnLookup> {
    let psn = PsnLookup {
        main_connection: symbol(c"CGSMainConnectionID"),
        get_window_owner: symbol(c"SLSGetWindowOwner"),
        get_connection_psn: symbol(c"SLSGetConnectionPSN"),
        get_process_for_pid: symbol(c"GetProcessForPID"),
    };
    psn.can_resolve().then_some(psn)
}

fn resolve_required() -> Option<RequiredSpi> {
    if disabled_by_env() {
        return None;
    }
    ensure_skylight_loaded()?;
    Some(RequiredSpi {
        post_to_pid: symbol(c"SLEventPostToPid")?,
        set_integer: symbol(c"SLEventSetIntegerValueField")?,
        post_record: symbol(c"SLPSPostEventRecordTo")?,
        get_front: symbol(c"_SLPSGetFrontProcess")?,
        set_window_location: symbol(c"CGEventSetWindowLocation")?,
        psn: lookup()?,
    })
}

fn resolve_foreground() -> Option<ForegroundSpi> {
    if disabled_by_env() {
        return None;
    }
    ensure_skylight_loaded()?;
    Some(ForegroundSpi {
        set_front: symbol(c"_SLPSSetFrontProcessWithOptions")?,
        psn: lookup()?,
    })
}

fn resolve_authentication() -> Option<AuthenticationSpi> {
    Some(AuthenticationSpi {
        set_message: symbol(c"SLEventSetAuthenticationMessage")?,
        objc_get_class: symbol(c"objc_getClass")?,
        sel_register_name: symbol(c"sel_registerName")?,
        class_responds: symbol(c"class_respondsToSelector")?,
        factory: symbol(c"objc_msgSend")?,
    })
}

fn ensure_skylight_loaded() -> Option<()> {
    static LOADED: LazyLock<bool> = LazyLock::new(|| {
        let path = c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight";
        // SAFETY: `path` is a static NUL-terminated framework path; the handle
        // is intentionally process-lived.
        !unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) }.is_null()
    });
    (*LOADED).then_some(())
}

fn raw_symbol(name: &CStr) -> Option<NonNull<c_void>> {
    // SAFETY: `name` is NUL-terminated and RTLD_DEFAULT is valid for
    // process-wide lookup.
    NonNull::new(unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) })
}

fn symbol<T: Copy>(name: &CStr) -> Option<T> {
    raw_symbol(name).map(|raw| cast_symbol(raw.as_ptr()))
}

#[cfg(test)]
#[path = "spi_tests.rs"]
mod tests;

fn cast_symbol<T: Copy>(raw: *mut c_void) -> T {
    const { assert!(mem::size_of::<T>() == mem::size_of::<*mut c_void>()) };
    // SAFETY: Every callsite requests the exact C signature documented in its
    // function-pointer alias, and the size assertion above rules out reading
    // past the pointer.
    unsafe { mem::transmute_copy::<*mut c_void, T>(&raw) }
}
