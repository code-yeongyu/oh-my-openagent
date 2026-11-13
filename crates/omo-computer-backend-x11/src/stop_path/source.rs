//! Which XI2 source devices may stop input. Only a person at a keyboard stops computer use:
//! key events from an XTEST device (`xdotool`, any client's `XTestFakeKeyEvent`, the engine's
//! own input) never count, and neither do events from a device the server cannot describe.

use std::collections::BTreeMap;

use super::server::{DeviceFacts, RawKeyServer};

/// Whether a device name is the server's "<master> XTEST keyboard" slave; kept beside the
/// property check for servers that do not set the property.
fn named_xtest(name: &[u8]) -> bool {
    name.windows(5).any(|window| window == b"XTEST")
}

/// A described device's classification and whether it may be cached. Fails closed: a lookup
/// that failed (a client can add a master, chord through its XTEST slave and remove it at once)
/// or a property read that failed is not a physical keyboard, and a failed property read is
/// not cached, so a real keyboard is asked again on its next press.
#[must_use]
pub fn classify(found: Option<&DeviceFacts>) -> (bool, bool) {
    let Some(device) = found else {
        return (false, false);
    };
    let xtest = device.xtest_property.unwrap_or(true)
        || (device.slave_keyboard && named_xtest(&device.name));
    (!xtest, device.xtest_property.is_some())
}

/// Per-connection cache of source classifications, cleared on every hierarchy change because
/// device ids are reused after removal.
#[derive(Debug, Default)]
pub struct Sources {
    known: BTreeMap<u16, bool>,
}

impl Sources {
    pub fn is_physical(&mut self, server: &mut dyn RawKeyServer, device: u16) -> bool {
        if let Some(&physical) = self.known.get(&device) {
            return physical;
        }
        let (physical, cache) = classify(server.describe(device).as_ref());
        if cache {
            self.known.insert(device, physical);
        }
        physical
    }

    pub fn clear(&mut self) {
        self.known.clear();
    }
}
