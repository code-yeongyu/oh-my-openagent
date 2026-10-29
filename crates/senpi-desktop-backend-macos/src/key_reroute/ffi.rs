use std::ffi::c_void;
use libc::pid_t;

pub(super) type Ref = *mut c_void;
pub(super) type ConstRef = *const c_void;
pub(super) type Callback = extern "C" fn(Ref, u32, Ref, Ref) -> Ref;

/// `kCGAnnotatedSessionEventTap`: sees the notifications `WindowServer` sends
/// to processes.
pub(super) const ANNOTATED_SESSION: u32 = 2;
pub(super) const HEAD_INSERT: u32 = 0;
pub(super) const TAIL_APPEND: u32 = 1;
pub(super) const ACTIVE_FILTER: u32 = 0;
pub(super) const LISTEN_ONLY: u32 = 1;
pub(super) const KEY_DOWN: u32 = 10;
pub(super) const KEY_UP: u32 = 11;
pub(super) const FLAGS_CHANGED: u32 = 12;
/// `WindowServer`'s process notification event.
pub(super) const PROCESS_NOTIFICATION: u32 = 21;
pub(super) const TAP_DISABLED_BY_TIMEOUT: u32 = 0xffff_fffe;
pub(super) const TAP_DISABLED_BY_USER_INPUT: u32 = 0xffff_ffff;
pub(super) const FIELD_SOURCE_PID: u32 = 41;
/// `kCGEventSourceUserData`: the engine marker on events this process
/// posts to the HID stream.
pub(super) const FIELD_SOURCE_USER_DATA: u32 = 42;
/// `kCGKeyboardEventAutorepeat`: non-zero on a held key's repeats.
pub(super) const FIELD_AUTOREPEAT: u32 = 8;
/// `kCGKeyboardEventKeycode`.
pub(super) const FIELD_KEYCODE: u32 = 9;
/// The process a notification is delivered to.
pub(super) const FIELD_RECIPIENT_PID: u32 = 40;
/// Which notification it is.
pub(super) const FIELD_NOTIFICATION: u32 = 64;
/// The process it is about: the new front app, or the process that took or
/// gave back the keyboard.
pub(super) const FIELD_SUBJECT_PID: u32 = 73;
/// `kCGEventSourceStateHIDSystemState`.
pub(super) const HID_SYSTEM_STATE: i32 = 1;
/// Left, right and other mouse button down and up.
pub(super) const MOUSE_BUTTON_EVENTS: [u32; 6] = [1, 2, 3, 4, 25, 26];

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
	pub(super) fn CGEventTapCreate(
		tap: u32,
		place: u32,
		options: u32,
		mask: u64,
		callback: Callback,
		user: Ref,
	) -> Ref;
	pub(super) fn CGEventTapCreateForPid(
		pid: pid_t,
		place: u32,
		options: u32,
		mask: u64,
		callback: Callback,
		user: Ref,
	) -> Ref;
	pub(super) fn CGEventTapEnable(tap: Ref, enable: bool);
	pub(super) fn CGEventGetIntegerValueField(event: Ref, field: u32) -> i64;
	pub(super) fn CGEventGetFlags(event: Ref) -> u64;
	pub(super) fn CGEventPostToPid(pid: pid_t, event: core_graphics::sys::CGEventRef);
	pub(super) fn CGEventSourceCounterForEventType(state: i32, event_type: u32) -> u32;
	pub(super) fn CGEventSourceFlagsState(state: i32) -> u64;
	pub(super) fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
	pub(super) static kCFRunLoopDefaultMode: ConstRef;
	pub(super) fn CFMachPortCreateRunLoopSource(allocator: ConstRef, port: Ref, order: isize) -> Ref;
	pub(super) fn CFRunLoopGetCurrent() -> Ref;
	pub(super) fn CFRunLoopAddSource(run_loop: Ref, source: Ref, mode: ConstRef);
	pub(super) fn CFRunLoopRemoveSource(run_loop: Ref, source: Ref, mode: ConstRef);
	pub(super) fn CFRunLoopRunInMode(mode: ConstRef, seconds: f64, return_after_source: bool) -> i32;
	pub(super) fn CFRelease(object: ConstRef);
	pub(super) fn CFRetain(object: ConstRef) -> ConstRef;
	pub(super) fn CFMachPortInvalidate(port: Ref);
}
