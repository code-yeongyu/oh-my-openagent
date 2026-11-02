//! Strict primitive-only transport dictionaries. JSON is not decoded here.
use crate::{
    connection::{Envelope, TransportError, MAX_REQUEST_BYTES},
    native::{self, Object, Raw},
};
use std::{
    ffi::{c_char, c_void, CStr},
    ptr,
};

// SAFETY: declarations match the macOS SDK XPC dictionary/data/integer ABI.
unsafe extern "C" {
    #[cfg(test)]
    static _xpc_type_endpoint: u8;
    fn xpc_dictionary_create(keys: *const *const c_char, values: *const Raw, count: usize) -> Raw;
    fn xpc_dictionary_create_reply(original: Raw) -> Raw;
    fn xpc_dictionary_get_count(dictionary: Raw) -> usize;
    fn xpc_dictionary_get_value(dictionary: Raw, key: *const c_char) -> Raw;
    fn xpc_dictionary_set_data(
        dictionary: Raw,
        key: *const c_char,
        bytes: *const c_void,
        length: usize,
    );
    fn xpc_dictionary_set_uint64(dictionary: Raw, key: *const c_char, value: u64);
    fn xpc_dictionary_set_value(dictionary: Raw, key: *const c_char, value: Raw);
    fn xpc_data_get_length(data: Raw) -> usize;
    fn xpc_data_get_bytes_ptr(data: Raw) -> *const c_void;
    fn xpc_uint64_get_value(value: Raw) -> u64;
}

pub(crate) const VERSION: u64 = 1;

pub(crate) struct Dictionary(Object);

impl Dictionary {
    #[cfg(test)]
    pub(crate) fn test_endpoint(&self) -> Result<native::Endpoint, TransportError> {
        let raw = self.value(c"endpoint", ptr::addr_of!(_xpc_type_endpoint).cast())?;
        // SAFETY: value proved endpoint type, retained by self throughout this call.
        unsafe { native::Endpoint::retained_for_test(raw) }
    }

    pub(crate) fn new() -> Result<Self, TransportError> {
        // SAFETY: zero entries permits null keys and values.
        let raw = unsafe { xpc_dictionary_create(ptr::null(), ptr::null(), 0) };
        // SAFETY: dictionary_create returned an owned reference.
        unsafe { Object::owned(raw) }.map(Self)
    }

    /// Only for a callback argument; fabricated dictionaries cannot pass O1.
    pub(crate) unsafe fn received(raw: Raw) -> Result<Self, TransportError> {
        // SAFETY: caller guarantees a live callback object.
        if unsafe { native::xpc_get_type(raw) }
            != ptr::addr_of!(native::_xpc_type_dictionary).cast()
        {
            return Err(TransportError::Dictionary);
        }
        // SAFETY: live dictionary borrowed from XPC is retained for this scope.
        unsafe { Object::retained(raw) }.map(Self)
    }

    pub(crate) fn raw(&self) -> Raw {
        self.0.raw()
    }

    pub(crate) fn reply(&self) -> Result<Self, TransportError> {
        // SAFETY: self retains the received dictionary throughout reply creation.
        let raw = unsafe { xpc_dictionary_create_reply(self.raw()) };
        // Plain one-way senders receive a normal event; reply senders keep their context.
        if raw.is_null() {
            return Self::new();
        }
        // SAFETY: create_reply returns a new owned dictionary.
        unsafe { Object::owned(raw) }.map(Self)
    }

    pub(crate) fn verify(&self) -> Result<crate::VerifiedPeer, crate::RejectReason> {
        let pointer =
            ptr::NonNull::new(self.raw()).ok_or(crate::RejectReason::MissingSecurityObject)?;
        // SAFETY: Dictionary::received retained this actual received dictionary;
        // production calls this method only on callback objects, before decoding.
        let message = unsafe { crate::identity::XpcMessage::from_raw(pointer) };
        crate::identity::SecurityVerifier::from_xpc_message(message).verify_privileged_client()
    }

    pub(crate) fn count(&self) -> usize {
        // SAFETY: Dictionary guarantees the object type and lifetime.
        unsafe { xpc_dictionary_get_count(self.raw()) }
    }

    fn value(&self, key: &CStr, kind: *const c_void) -> Result<Raw, TransportError> {
        // SAFETY: dictionary and NUL-terminated key are live throughout the call.
        let value = unsafe { xpc_dictionary_get_value(self.raw(), key.as_ptr()) };
        if value.is_null() {
            return Err(TransportError::Dictionary);
        }
        // SAFETY: dictionary retains the non-null borrowed value.
        if unsafe { native::xpc_get_type(value) } != kind {
            return Err(TransportError::Dictionary);
        }
        Ok(value)
    }

    pub(crate) fn uint(&self, key: &CStr) -> Result<u64, TransportError> {
        let raw = self.value(key, ptr::addr_of!(native::_xpc_type_uint64).cast())?;
        // SAFETY: value() proved uint64 type and self retains it.
        Ok(unsafe { xpc_uint64_get_value(raw) })
    }

    pub(crate) fn data(&self, key: &CStr, max: usize) -> Result<&[u8], TransportError> {
        let raw = self.value(key, ptr::addr_of!(native::_xpc_type_data).cast())?;
        // SAFETY: value() proved data type and self retains it.
        let len = unsafe { xpc_data_get_length(raw) };
        if len == 0 || len > max {
            return Err(TransportError::Dictionary);
        }
        // SAFETY: the checked data object remains alive for the returned borrow.
        let bytes = unsafe { xpc_data_get_bytes_ptr(raw) };
        if bytes.is_null() {
            return Err(TransportError::Dictionary);
        }
        // SAFETY: libxpc guarantees len readable bytes; borrow cannot outlive self.
        Ok(unsafe { std::slice::from_raw_parts(bytes.cast(), len) })
    }

    pub(crate) fn nonce(&self, key: &CStr) -> Result<[u8; 32], TransportError> {
        self.data(key, 32)?
            .try_into()
            .map_err(|_| TransportError::Dictionary)
    }

    pub(crate) fn put_uint(&mut self, key: &CStr, value: u64) {
        // SAFETY: exclusive dictionary mutation, live key and integer value.
        unsafe { xpc_dictionary_set_uint64(self.raw(), key.as_ptr(), value) };
    }

    pub(crate) fn put_data(&mut self, key: &CStr, bytes: &[u8]) {
        // SAFETY: XPC copies the live slice into this exclusively owned dictionary.
        unsafe {
            xpc_dictionary_set_data(self.raw(), key.as_ptr(), bytes.as_ptr().cast(), bytes.len())
        };
    }

    pub(crate) fn put_endpoint(&mut self, endpoint: &native::Endpoint) {
        // SAFETY: XPC retains the live immutable endpoint under a static key.
        unsafe { xpc_dictionary_set_value(self.raw(), c"endpoint".as_ptr(), endpoint.raw()) };
    }

    pub(crate) fn discovery(&self) -> Result<[u8; 32], TransportError> {
        if self.count() != 2 || self.uint(c"version")? != VERSION {
            return Err(TransportError::Dictionary);
        }
        self.nonce(c"challenge")
    }

    pub(crate) fn envelope(&self) -> Result<Envelope, TransportError> {
        if self.uint(c"version")? != VERSION {
            return Err(TransportError::Dictionary);
        }
        if self.count() == 2 {
            return self.discovery().map(Envelope::Challenge);
        }
        match self.uint(c"kind")? {
            1 if self.count() == 4 => {
                let bytes = self.data(c"hashes", 64 * 32)?;
                let (chunks, remainder) = bytes.as_chunks::<32>();
                if !remainder.is_empty() {
                    return Err(TransportError::Dictionary);
                }
                Ok(Envelope::Approve {
                    hashes: chunks.to_vec(),
                    lifetime: std::time::Duration::from_millis(self.uint(c"ttl_ms")?),
                })
            }
            2 if self.count() == 5 => Ok(Envelope::Frame {
                capability: self.nonce(c"capability")?,
                sequence: self.uint(c"sequence")?,
                payload: self.data(c"payload", MAX_REQUEST_BYTES)?.to_vec(),
            }),
            _ => Err(TransportError::Dictionary),
        }
    }
}
