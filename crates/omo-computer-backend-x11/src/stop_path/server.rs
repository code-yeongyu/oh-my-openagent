//! The seam between the stop listener and the X server: everything the listener reads goes
//! through [`RawKeyServer`], so the tests drive it with an in-memory server and the engine
//! with its own XI2 connection.

/// One event of the raw key stream, as XI2 delivers it on the root for every master device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawKey {
    Press {
        device: u16,
        code: u8,
    },
    Release {
        device: u16,
        code: u8,
    },
    /// A device was added or removed; device ids are reused, so every cached
    /// classification is dropped.
    HierarchyChanged,
}

/// What the server reports for a raw event's source device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceFacts {
    pub slave_keyboard: bool,
    pub name: Vec<u8>,
    /// Whether the device carries the server's `XTEST Device` property; `None` when the
    /// property read failed.
    pub xtest_property: Option<bool>,
}

/// The core keyboard mapping (`GetKeyboardMapping`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyMap {
    pub min_keycode: u8,
    pub keysyms_per_keycode: u8,
    pub keysyms: Vec<u32>,
}

impl KeyMap {
    /// Every keycode that produces `keysym` in any column.
    #[must_use]
    pub fn codes(&self, keysym: u32) -> Vec<u8> {
        let width = usize::from(self.keysyms_per_keycode.max(1));
        self.keysyms
            .chunks(width)
            .enumerate()
            .filter(|(_, column)| column.contains(&keysym))
            .filter_map(|(index, _)| u8::try_from(usize::from(self.min_keycode) + index).ok())
            .collect()
    }
}

/// The connection broke, or a request on it failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lost;

/// The X server as the stop listener reads it, on a connection of its own.
pub trait RawKeyServer: Send {
    /// The XInput version the server speaks, `(0, 0)` without the extension.
    ///
    /// # Errors
    /// The connection broke.
    fn xi_version(&mut self) -> Result<(u16, u16), Lost>;

    /// Selects raw key press/release on every master device and hierarchy changes on every
    /// device.
    ///
    /// # Errors
    /// The server refused the selection or the connection broke.
    fn select_raw_keys(&mut self) -> Result<(), Lost>;

    /// # Errors
    /// The connection broke.
    fn keymap(&mut self) -> Result<KeyMap, Lost>;

    /// The next pending raw key event without blocking, `None` when none is queued.
    ///
    /// # Errors
    /// The connection broke.
    fn next_raw_key(&mut self) -> Result<Option<RawKey>, Lost>;

    /// The server's description of `device`; `None` when the lookup failed or the device is
    /// already gone.
    fn describe(&mut self, device: u16) -> Option<DeviceFacts>;

    /// One heartbeat: a round trip the server must answer (`GetInputFocus`).
    fn answers(&mut self) -> bool;
}
