//! Private SkyLight SPI resolution: the dlopen/dlsym probe, the typed
//! function-pointer sets, and the `SENPI_DESKTOP_DISABLE_SKYLIGHT` test hook.
//!
//! Nothing here posts events; it only hands back atomically resolved,
//! exact-signature function pointers (see the per-field types).

use std::ffi::{c_void, CStr};
use std::mem;
use std::sync::LazyLock;

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
    pub(super) get_front: SLPSGetFrontProcessFn,
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
static FOREGROUND: LazyLock<Option<ForegroundSpi>> = LazyLock::new(resolve_foreground);
pub(super) static AUTHENTICATION: LazyLock<Option<AuthenticationSpi>> = LazyLock::new(resolve_authentication);

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
        get_front: symbol(c"_SLPSGetFrontProcess")?,
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

fn symbol<T: Copy>(name: &CStr) -> Option<T> {
    // SAFETY: `name` is NUL-terminated and RTLD_DEFAULT is valid for
    // process-wide lookup.
    let raw = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    if raw.is_null() {
        return None;
    }
    // SAFETY: Every callsite requests the exact C signature documented in its
    // function-pointer alias.
    Some(unsafe { mem::transmute_copy::<*mut c_void, T>(&raw) })
}
