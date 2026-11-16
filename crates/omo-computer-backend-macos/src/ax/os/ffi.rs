//! The ApplicationServices and CoreFoundation calls of the AX server, declared once.

use std::ffi::c_void;

use crate::capture::os::cf::CfRef;

pub const AX_SUCCESS: i32 = 0;
pub const AX_INVALID_ELEMENT: i32 = -25202;
pub const AX_CANNOT_COMPLETE: i32 = -25204;
pub const AX_ATTRIBUTE_UNSUPPORTED: i32 = -25205;
pub const AX_ACTION_UNSUPPORTED: i32 = -25206;

pub const VALUE_CGPOINT: u32 = 1;
pub const VALUE_CGSIZE: u32 = 2;
pub const VALUE_CFRANGE: u32 = 4;
pub const VALUE_AXERROR: u32 = 5;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CfRange {
    pub location: isize,
    pub length: isize,
}

pub type ObserverCallback = unsafe extern "C" fn(CfRef, CfRef, CfRef, *mut c_void);

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    pub fn AXUIElementCreateApplication(pid: i32) -> CfRef;
    pub fn AXUIElementCopyAttributeValue(
        element: CfRef,
        attribute: CfRef,
        value: *mut CfRef,
    ) -> i32;
    pub fn AXUIElementCopyMultipleAttributeValues(
        element: CfRef,
        attributes: CfRef,
        options: u32,
        values: *mut CfRef,
    ) -> i32;
    pub fn AXUIElementCopyAttributeValues(
        element: CfRef,
        attribute: CfRef,
        index: isize,
        max: isize,
        values: *mut CfRef,
    ) -> i32;
    pub fn AXUIElementPerformAction(element: CfRef, action: CfRef) -> i32;
    pub fn AXUIElementSetAttributeValue(element: CfRef, attribute: CfRef, value: CfRef) -> i32;
    pub fn AXUIElementSetMessagingTimeout(element: CfRef, seconds: f32) -> i32;
    pub fn AXValueGetType(value: CfRef) -> u32;
    pub fn AXValueGetValue(value: CfRef, kind: u32, out: *mut c_void) -> bool;
    pub fn AXValueCreate(kind: u32, value: *const c_void) -> CfRef;
    pub fn AXValueGetTypeID() -> usize;
    pub fn AXObserverCreate(pid: i32, callback: ObserverCallback, observer: *mut CfRef) -> i32;
    pub fn AXObserverAddNotification(
        observer: CfRef,
        element: CfRef,
        notification: CfRef,
        refcon: *mut c_void,
    ) -> i32;
    pub fn AXObserverGetRunLoopSource(observer: CfRef) -> CfRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub static kCFRunLoopDefaultMode: CfRef;
    pub static kCFBooleanTrue: CfRef;
    pub static kCFBooleanFalse: CfRef;
    pub static kCFTypeArrayCallBacks: c_void;
    pub fn CFRetain(value: CfRef) -> CfRef;
    pub fn CFGetTypeID(value: CfRef) -> usize;
    pub fn CFStringGetTypeID() -> usize;
    pub fn CFBooleanGetTypeID() -> usize;
    pub fn CFNumberGetTypeID() -> usize;
    pub fn CFArrayGetTypeID() -> usize;
    pub fn CFArrayCreate(
        allocator: CfRef,
        values: *const CfRef,
        count: isize,
        callbacks: *const c_void,
    ) -> CfRef;
    pub fn CFDataCreate(allocator: CfRef, bytes: *const u8, length: isize) -> CfRef;
    pub fn CFDataGetBytePtr(data: CfRef) -> *const u8;
    pub fn CFDataGetLength(data: CfRef) -> isize;
    pub fn CFRunLoopGetCurrent() -> CfRef;
    pub fn CFRunLoopAddSource(run_loop: CfRef, source: CfRef, mode: CfRef);
    pub fn CFRunLoopRunInMode(mode: CfRef, seconds: f64, return_after_source: bool) -> i32;
}
