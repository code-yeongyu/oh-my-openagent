use std::{
    ffi::{c_char, c_void, CStr},
    ptr::{self, NonNull},
};
pub(super) type Raw = *mut c_void;

// SAFETY: declarations match the public macOS SDK XPC object and dictionary ABI.
unsafe extern "C" {
    fn xpc_retain(object: Raw) -> Raw;
    fn xpc_release(object: Raw);
    pub(super) fn xpc_get_type(object: Raw) -> *const c_void;
    pub(super) static _xpc_type_dictionary: u8;
    pub(super) static _xpc_type_connection: u8;
    static _xpc_type_data: u8;
    static _xpc_type_endpoint: u8;
    fn xpc_dictionary_create(keys: *const *const c_char, values: *const Raw, count: usize) -> Raw;
    fn xpc_dictionary_create_reply(original: Raw) -> Raw;
    fn xpc_dictionary_get_value(dictionary: Raw, key: *const c_char) -> Raw;
    fn xpc_dictionary_get_count(dictionary: Raw) -> usize;
    fn xpc_dictionary_set_data(
        dictionary: Raw,
        key: *const c_char,
        bytes: *const c_void,
        len: usize,
    );
    fn xpc_dictionary_set_uint64(dictionary: Raw, key: *const c_char, value: u64);
    fn xpc_data_get_length(value: Raw) -> usize;
    fn xpc_data_get_bytes_ptr(value: Raw) -> *const c_void;
}

pub(super) struct Object(NonNull<c_void>);
// SAFETY: each Object has unique Rust ownership; received dictionaries are
// immutable. Moving a retained XPC reference across threads is supported.
unsafe impl Send for Object {}

impl Object {
    pub(super) unsafe fn owned(raw: Raw) -> Result<Self, String> {
        NonNull::new(raw)
            .map(Self)
            .ok_or_else(|| "null XPC object".to_owned())
    }
    pub(super) unsafe fn retained(raw: Raw) -> Result<Self, String> {
        // SAFETY: caller holds the current live XPC callback argument.
        let raw = unsafe { xpc_retain(raw) };
        // SAFETY: the retain transferred one owned reference.
        unsafe { Self::owned(raw) }
    }
    pub(super) fn raw(&self) -> Raw {
        self.0.as_ptr()
    }
    pub(super) fn dictionary() -> Result<Self, String> {
        // SAFETY: zero entries permits NULL arrays.
        let raw = unsafe { xpc_dictionary_create(ptr::null(), ptr::null(), 0) };
        // SAFETY: create returns one owned reference.
        unsafe { Self::owned(raw) }
    }
    pub(super) fn reply(&self) -> Result<Self, String> {
        // SAFETY: self is the retained request dictionary of the fixture listener.
        let raw = unsafe { xpc_dictionary_create_reply(self.raw()) };
        // SAFETY: create_reply returns one owned reference.
        unsafe { Self::owned(raw) }
    }
    pub(super) fn put_uint(&mut self, key: &CStr, value: u64) {
        // SAFETY: exclusively owned dictionary, valid C key.
        unsafe { xpc_dictionary_set_uint64(self.raw(), key.as_ptr(), value) };
    }
    pub(super) fn put_data(&mut self, key: &CStr, value: &[u8]) {
        // SAFETY: XPC copies the readable slice during exclusive mutation.
        unsafe {
            xpc_dictionary_set_data(self.raw(), key.as_ptr(), value.as_ptr().cast(), value.len())
        };
    }
    pub(super) fn data(&self, key: &CStr) -> Result<&[u8], String> {
        // SAFETY: self is a live dictionary; key is NUL-terminated.
        let raw = unsafe { xpc_dictionary_get_value(self.raw(), key.as_ptr()) };
        if raw.is_null() {
            return Err("missing data".to_owned());
        }
        // SAFETY: dictionary keeps this borrowed value alive.
        if unsafe { xpc_get_type(raw) } != ptr::addr_of!(_xpc_type_data).cast() {
            return Err("non-data value".to_owned());
        }
        // SAFETY: type was checked above.
        let len = unsafe { xpc_data_get_length(raw) };
        if len == 0 || len > 128 * 1024 * 1024 {
            return Err("invalid data length".to_owned());
        }
        // SAFETY: type was checked and dictionary retains the bytes.
        let bytes = unsafe { xpc_data_get_bytes_ptr(raw) };
        if bytes.is_null() {
            return Err("null data".to_owned());
        }
        // SAFETY: XPC promises len readable bytes; lifetime is bounded by self.
        Ok(unsafe { std::slice::from_raw_parts(bytes.cast(), len) })
    }
    pub(super) fn endpoint(&self) -> Result<Raw, String> {
        // SAFETY: self is a live dictionary with a static key.
        let value = unsafe { xpc_dictionary_get_value(self.raw(), c"endpoint".as_ptr()) };
        if value.is_null() {
            return Err("missing endpoint".to_owned());
        }
        // SAFETY: dictionary keeps the borrowed value alive.
        if unsafe { xpc_get_type(value) } != ptr::addr_of!(_xpc_type_endpoint).cast() {
            return Err("wrong endpoint type".to_owned());
        }
        Ok(value)
    }
    pub(super) fn count(&self) -> usize {
        // SAFETY: caller uses this only on a dictionary.
        unsafe { xpc_dictionary_get_count(self.raw()) }
    }
}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: releases this Object's sole owned reference exactly once.
        unsafe { xpc_release(self.raw()) };
    }
}
