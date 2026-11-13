//! The user's front application: the first regular ("Foreground") app in LaunchServices' front-to-back
//! order, which is what System Events reports and what owns the menu bar. WindowServer's front process and
//! LaunchServices' own front application can instead be an accessory app that only shows a floating panel
//! (#9084). The query is IPC to launchservicesd, so it stays live in the engine, which has no AppKit run loop
//! to refresh `NSWorkspace`.

use std::ffi::{c_void, CStr};
use std::sync::LazyLock;

use objc2_core_foundation::{CFArray, CFNumber, CFRetained, CFString, CFType};

/// `kLSDefaultSessionID`.
const DEFAULT_SESSION: i32 = -2;

type CopyFrontToBackFn = unsafe extern "C" fn(i32, u32) -> *mut c_void;
type CopyInformationItemFn = unsafe extern "C" fn(i32, *const c_void, *const c_void) -> *mut c_void;

struct LaunchServicesSpi {
    copy_front_to_back: CopyFrontToBackFn,
    copy_item: CopyInformationItemFn,
    pid_key: *const c_void,
    type_key: *const c_void,
    foreground: *const c_void,
}

// SAFETY: the resolved function pointers and the immutable CFString constants are process-lived and
// thread-safe to read.
unsafe impl Send for LaunchServicesSpi {}
// SAFETY: see `Send`; nothing is mutated after resolution.
unsafe impl Sync for LaunchServicesSpi {}

static SPI: LazyLock<Option<LaunchServicesSpi>> = LazyLock::new(|| {
    let path = c"/System/Library/Frameworks/CoreServices.framework/CoreServices";
    // SAFETY: a static NUL-terminated framework path; the handle is intentionally process-lived.
    let handle = unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_NOW) };
    if handle.is_null() {
        return None;
    }
    let lookup = |name: &CStr| {
        // SAFETY: `handle` is a live dlopen handle and `name` is NUL-terminated.
        let raw = unsafe { libc::dlsym(handle, name.as_ptr()) };
        (!raw.is_null()).then_some(raw)
    };
    let constant = |name: &CStr| {
        // SAFETY: each name is an exported `CFStringRef` variable; reading it yields that constant.
        let value = unsafe { *lookup(name)?.cast::<*const c_void>() };
        (!value.is_null()).then_some(value)
    };
    let copy_front_to_back = lookup(c"_LSCopyApplicationArrayInFrontToBackOrder")?;
    let copy_item = lookup(c"_LSCopyApplicationInformationItem")?;
    Some(LaunchServicesSpi {
        // SAFETY: both symbols have exactly the C signatures in their aliases (as `lsappinfo` uses them).
        copy_front_to_back: unsafe { std::mem::transmute::<*mut c_void, CopyFrontToBackFn>(copy_front_to_back) },
        // SAFETY: see above.
        copy_item: unsafe { std::mem::transmute::<*mut c_void, CopyInformationItemFn>(copy_item) },
        pid_key: constant(c"_kLSPIDKey")?,
        type_key: constant(c"_kLSApplicationTypeKey")?,
        foreground: constant(c"_kLSApplicationForegroundTypeKey")?,
    })
});

fn copy_item(spi: &LaunchServicesSpi, asn: &CFType, key: *const c_void) -> Option<CFRetained<CFType>> {
    let asn: *const CFType = asn;
    // SAFETY: `asn` is alive for the call and `key` is a process-lived constant; the copy returns +1 or null.
    let raw = unsafe { (spi.copy_item)(DEFAULT_SESSION, asn.cast(), key) };
    // SAFETY: a non-null result is a +1 CF object owned by the returned wrapper.
    std::ptr::NonNull::new(raw.cast::<CFType>()).map(|raw| unsafe { CFRetained::from_raw(raw) })
}

/// The pid of the front-most regular application, `None` when the SPI is missing or lists none.
pub(crate) fn front_application_pid() -> Option<libc::pid_t> {
    let spi = SPI.as_ref()?;
    // SAFETY: the SPI returns a +1 CFArray of ASNs (or null); ownership moves into `CFRetained`.
    let raw = std::ptr::NonNull::new(unsafe { (spi.copy_front_to_back)(DEFAULT_SESSION, 0) }.cast::<CFArray>())?;
    // SAFETY: a +1 CFArray from a copy function.
    let order: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: every element of the front-to-back array is an ASN CFType.
    let order = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(order) };
    // SAFETY: `foreground` is the `_kLSApplicationForegroundTypeKey` CFString constant.
    let foreground: &CFString = unsafe { &*spi.foreground.cast::<CFString>() };
    order.iter().find_map(|asn| {
        let kind = copy_item(spi, &asn, spi.type_key)?.downcast::<CFString>().ok()?;
        if *kind != *foreground {
            return None;
        }
        let pid = copy_item(spi, &asn, spi.pid_key)?.downcast::<CFNumber>().ok()?.as_i64()?;
        libc::pid_t::try_from(pid).ok().filter(|&pid| pid > 0)
    })
}
