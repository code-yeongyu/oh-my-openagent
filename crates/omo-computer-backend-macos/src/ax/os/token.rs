//! The private remote-token pair (`_AXUIElementRemoteTokenCreate` /
//! `_AXUIElementCreateWithRemoteToken`, ledger row `ax-remote-token`, UNMEASURED): resolved per
//! symbol at session open; without it refs resolve through the retained element.

use super::ffi;
use super::server::Server;
use crate::ax::seam::{Element, RemoteToken};
use crate::capture::os::cf::{CfRef, Owned};
use crate::capture::os::symbols;

type Create = unsafe extern "C" fn(CfRef) -> CfRef;
type Resolve = unsafe extern "C" fn(CfRef) -> CfRef;

/// Both symbols, or none.
pub struct TokenSymbols {
    create: Create,
    resolve: Resolve,
}

impl TokenSymbols {
    pub fn probe() -> Option<Self> {
        Some(Self {
            create: symbols::lookup(c"_AXUIElementRemoteTokenCreate")?,
            resolve: symbols::lookup(c"_AXUIElementCreateWithRemoteToken")?,
        })
    }
}

/// The bytes of a CFData; `None` for any other CF type (the unmeasured symbol's answer is not
/// trusted to be one).
pub(super) fn data_bytes(data: CfRef) -> Option<Vec<u8>> {
    // SAFETY: plain type-id reads on a live CF value.
    if unsafe { ffi::CFGetTypeID(data) != ffi::CFDataGetTypeID() } {
        return None;
    }
    // SAFETY: `data` is a CFData (checked above).
    let (bytes, length) = unsafe { (ffi::CFDataGetBytePtr(data), ffi::CFDataGetLength(data)) };
    let length = usize::try_from(length).ok()?;
    if length == 0 || bytes.is_null() {
        return Some(Vec::new());
    }
    // SAFETY: the CFData owns `length` (> 0) bytes at the non-null `bytes`.
    Some(unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec())
}

impl RemoteToken for Server {
    fn token(&mut self, element: Element) -> Option<Vec<u8>> {
        let create = self.token.as_ref()?.create;
        // SAFETY: the probed symbol's signature; a +1 CFData or null.
        let data = Owned::new(unsafe { create(self.get(element)?) })?;
        data_bytes(data.get())
    }

    fn resolve(&mut self, token: &[u8]) -> Option<Element> {
        let resolve = self.token.as_ref()?.resolve;
        // SAFETY: `token` holds `len` bytes; +1 CFData.
        let data = Owned::new(unsafe {
            ffi::CFDataCreate(
                std::ptr::null(),
                token.as_ptr(),
                isize::try_from(token.len()).ok()?,
            )
        })?;
        // SAFETY: the probed symbol's signature; a +1 AXUIElement or null.
        let element = Owned::new(unsafe { resolve(data.get()) })?;
        Some(self.insert(element))
    }
}
