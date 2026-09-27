//! Raw AXUIElement primitives: trust, element creation, messaging timeouts,
//! typed attribute reads, and the `AxHandle` wrapping.

use std::ffi::c_void;
use std::mem;
use std::ptr::{self, NonNull};
use std::sync::LazyLock;

use objc2_application_services::{AXError, AXIsProcessTrusted, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFArray, CFBoolean, CFRetained, CFString, CFType, CGPoint, CGSize};
use senpi_desktop_core::ax::{AxBounds, AxHandle};
use senpi_desktop_core::error::{CoreResult, DesktopError};

const AX_TIMEOUT_SECONDS: f32 = 2.0;

type GetWindowIdFn = unsafe extern "C" fn(&AXUIElement, *mut u32) -> AXError;

static GET_WINDOW_ID: LazyLock<Option<GetWindowIdFn>> = LazyLock::new(|| {
    // SAFETY: The symbol name is a static NUL-terminated string for a
    // process-wide lookup.
    let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"_AXUIElementGetWindow".as_ptr()) };
    if symbol.is_null() {
        None
    } else {
        // SAFETY: `_AXUIElementGetWindow` has the exact AXUIElementRef,
        // CGWindowID* -> AXError ABI above.
        Some(unsafe { mem::transmute::<*mut c_void, GetWindowIdFn>(symbol) })
    }
});

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: libc::pid_t) -> *mut AXUIElement;
}

/// Non-prompting Accessibility trust check.
pub fn is_trusted() -> bool {
    // SAFETY: This non-prompting TCC query takes no arguments and only reads
    // the current trust state.
    unsafe { AXIsProcessTrusted() }
}

pub(super) fn ensure_trusted() -> CoreResult<()> {
    if is_trusted() {
        Ok(())
    } else {
        Err(DesktopError::permission_denied(
            "macOS Accessibility permission is not granted for this process",
        ))
    }
}

pub(super) fn handle(element: CFRetained<AXUIElement>) -> AxHandle {
    AxHandle::native(element)
}

/// The AXUIElement behind a handle this backend produced.
pub(super) fn element(handle: &AxHandle) -> CoreResult<&AXUIElement> {
    handle
        .downcast_native::<CFRetained<AXUIElement>>()
        .map(|element| &**element)
        .ok_or_else(|| DesktopError::ax_failed("non-macOS AX handle passed to MacAx"))
}

pub(crate) fn create_application(pid: libc::pid_t) -> CoreResult<CFRetained<AXUIElement>> {
    // SAFETY: AXUIElementCreateApplication accepts any process id and returns
    // a +1 retained CF object.
    let raw = unsafe { AXUIElementCreateApplication(pid) };
    let pointer = NonNull::new(raw).ok_or_else(|| {
        DesktopError::ax_failed(format!("AXUIElementCreateApplication({pid}) returned null"))
    })?;
    // SAFETY: Create-rule ownership transfers the +1 reference into CFRetained.
    Ok(unsafe { CFRetained::from_raw(pointer) })
}

pub(super) fn create_system_wide() -> CFRetained<AXUIElement> {
    // SAFETY: The framework constructor returns a valid create-rule retained
    // system-wide element.
    unsafe { AXUIElement::new_system_wide() }
}

pub(crate) fn set_timeout(element: &AXUIElement) -> CoreResult<()> {
    // SAFETY: The retained AX element stays valid for the synchronous update.
    let error = unsafe { element.set_messaging_timeout(AX_TIMEOUT_SECONDS) };
    ax_result(error, "AXUIElementSetMessagingTimeout(2.0) failed")
}

/// The CGWindowID behind an AX window, when the private SPI is present.
pub(crate) fn window_id(element: &AXUIElement) -> Option<u32> {
    let get_id = (*GET_WINDOW_ID)?;
    let mut id = 0u32;
    // SAFETY: `id` is writable and the retained element outlives the call.
    (unsafe { get_id(element, &mut id) } == AXError::Success).then_some(id)
}

pub(super) fn copy_attribute_result(
    element: &AXUIElement,
    attribute: &str,
) -> Result<Option<CFRetained<CFType>>, AXError> {
    let attribute = CFString::from_str(attribute);
    let mut output: *const CFType = ptr::null();
    let slot = NonNull::from(&mut output);
    // SAFETY: `slot` is writable and receives a create-rule retained CF object
    // on success.
    let error = unsafe { element.copy_attribute_value(&attribute, slot) };
    if error != AXError::Success {
        return Err(error);
    }
    let Some(pointer) = NonNull::new(output.cast_mut()) else {
        return Ok(None);
    };
    // SAFETY: AXUIElementCopyAttributeValue returns a +1 object on success.
    Ok(Some(unsafe { CFRetained::from_raw(pointer) }))
}

pub(crate) fn copy_attribute(element: &AXUIElement, attribute: &str) -> Option<CFRetained<CFType>> {
    copy_attribute_result(element, attribute).ok().flatten()
}

pub(crate) fn copy_string(element: &AXUIElement, attribute: &str) -> Option<String> {
    copy_attribute(element, attribute)?
        .downcast::<CFString>()
        .ok()
        .map(|value| value.to_string())
}

pub(crate) fn copy_bool(element: &AXUIElement, attribute: &str) -> Option<bool> {
    copy_attribute(element, attribute)?
        .downcast::<CFBoolean>()
        .ok()
        .map(|value| value.as_bool())
}

pub(crate) fn copy_element(element: &AXUIElement, attribute: &str) -> Option<CFRetained<AXUIElement>> {
    copy_attribute(element, attribute)?.downcast::<AXUIElement>().ok()
}

pub(crate) fn copy_elements(element: &AXUIElement, attribute: &str) -> Option<Vec<CFRetained<AXUIElement>>> {
    let array = copy_attribute(element, attribute)?.downcast::<CFArray>().ok()?;
    // SAFETY: AXWindows/AXChildren are documented CFArray<AXUIElement> values.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(array) };
    Some(
        array
            .iter()
            .filter_map(|value| value.downcast::<AXUIElement>().ok())
            .collect(),
    )
}

/// Strings of a create-rule CFArray written by an AX copy call.
pub(super) fn copy_name_array(
    copy: impl FnOnce(NonNull<*const CFArray>) -> AXError,
) -> Result<Vec<String>, AXError> {
    let mut output: *const CFArray = ptr::null();
    let error = copy(NonNull::from(&mut output));
    if error != AXError::Success {
        return Err(error);
    }
    let Some(pointer) = NonNull::new(output.cast_mut()) else {
        return Ok(Vec::new());
    };
    // SAFETY: The successful copy call returned this array at +1 retain count.
    let array: CFRetained<CFArray> = unsafe { CFRetained::from_raw(pointer) };
    // SAFETY: AX attribute and action name arrays hold CFString CFTypes.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(array) };
    Ok(array
        .iter()
        .filter_map(|value| value.downcast::<CFString>().ok().map(|name| name.to_string()))
        .collect())
}

pub(crate) fn bounds(element: &AXUIElement) -> Option<AxBounds> {
    let position = copy_attribute(element, "AXPosition")?
        .downcast::<AXValue>()
        .ok()?;
    let size = copy_attribute(element, "AXSize")?.downcast::<AXValue>().ok()?;
    let mut point = CGPoint { x: 0.0, y: 0.0 };
    let mut dimensions = CGSize {
        width: 0.0,
        height: 0.0,
    };
    // SAFETY: The output pointer targets a live CGPoint and the requested type
    // matches AXPosition.
    let got_point = unsafe { position.value(AXValueType::CGPoint, NonNull::from(&mut point).cast()) };
    // SAFETY: The output pointer targets a live CGSize and the requested type
    // matches AXSize.
    let got_size = unsafe { size.value(AXValueType::CGSize, NonNull::from(&mut dimensions).cast()) };
    (got_point && got_size).then_some(AxBounds {
        x: point.x,
        y: point.y,
        width: dimensions.width,
        height: dimensions.height,
    })
}

pub(super) fn retained_element(pointer: *const AXUIElement) -> CoreResult<CFRetained<AXUIElement>> {
    let pointer = NonNull::new(pointer.cast_mut())
        .ok_or_else(|| DesktopError::ax_failed("AX operation returned a null element"))?;
    // SAFETY: Successful AX copy operations return their output element at +1
    // retain count.
    Ok(unsafe { CFRetained::from_raw(pointer) })
}

pub(super) fn ax_result(error: AXError, context: impl Into<String>) -> CoreResult<()> {
    if error == AXError::Success {
        Ok(())
    } else {
        Err(DesktopError::ax_failed(format!("{} ({error:?})", context.into())))
    }
}
