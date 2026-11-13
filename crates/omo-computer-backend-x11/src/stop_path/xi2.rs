//! The live [`RawKeyServer`]: a dedicated x11rb connection to the display the backend uses.

use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::xinput::{self, ConnectionExt as _, Device, DeviceType, XIEventMask};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, Window};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use super::server::{DeviceFacts, KeyMap, Lost, RawKey, RawKeyServer};

/// The property the X server sets on every XTEST device it creates.
const XTEST_PROPERTY: &[u8] = b"XTEST Device";

pub struct Xi2Server {
    conn: RustConnection,
    root: Window,
    /// The `XTEST Device` atom; `None` once the server said it has none.
    xtest_atom: Option<Option<u32>>,
}

fn lost<E>(_error: E) -> Lost {
    Lost
}

impl Xi2Server {
    /// Opens a connection of its own to `display`.
    ///
    /// # Errors
    /// [`Lost`] when the display cannot be reached.
    pub fn connect(display: &str) -> Result<Self, Lost> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(lost)?;
        let root = conn.setup().roots.get(screen).ok_or(Lost)?.root;
        Ok(Self {
            conn,
            root,
            xtest_atom: None,
        })
    }

    fn xtest_atom(&mut self) -> Option<u32> {
        if let Some(atom) = self.xtest_atom {
            return atom;
        }
        let reply = self
            .conn
            .intern_atom(true, XTEST_PROPERTY)
            .ok()
            .and_then(|cookie| cookie.reply().ok())?;
        let atom = (reply.atom != u32::from(AtomEnum::NONE)).then_some(reply.atom);
        self.xtest_atom = Some(atom);
        atom
    }

    fn has_property(&self, device: u16, property: u32) -> Option<bool> {
        self.conn
            .xinput_xi_get_property(device, false, property, u32::from(AtomEnum::ANY), 0, 1)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| reply.type_ != u32::from(AtomEnum::NONE))
    }
}

impl RawKeyServer for Xi2Server {
    fn xi_version(&mut self) -> Result<(u16, u16), Lost> {
        let present = self
            .conn
            .extension_information(xinput::X11_EXTENSION_NAME)
            .map_err(lost)?
            .is_some();
        if !present {
            return Ok((0, 0));
        }
        let reply = self
            .conn
            .xinput_xi_query_version(2, 2)
            .map_err(lost)?
            .reply()
            .map_err(lost)?;
        Ok((reply.major_version, reply.minor_version))
    }

    fn select_raw_keys(&mut self) -> Result<(), Lost> {
        let keys = xinput::EventMask {
            deviceid: Device::ALL_MASTER.into(),
            mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
        };
        let hierarchy = xinput::EventMask {
            deviceid: Device::ALL.into(),
            mask: vec![XIEventMask::HIERARCHY],
        };
        self.conn
            .xinput_xi_select_events(self.root, &[keys, hierarchy])
            .map_err(lost)?
            .check()
            .map_err(lost)
    }

    fn keymap(&mut self) -> Result<KeyMap, Lost> {
        let (min, max) = (self.conn.setup().min_keycode, self.conn.setup().max_keycode);
        let count = max.saturating_sub(min).saturating_add(1);
        let reply = self
            .conn
            .get_keyboard_mapping(min, count)
            .map_err(lost)?
            .reply()
            .map_err(lost)?;
        Ok(KeyMap {
            min_keycode: min,
            keysyms_per_keycode: reply.keysyms_per_keycode,
            keysyms: reply.keysyms,
        })
    }

    fn next_raw_key(&mut self) -> Result<Option<RawKey>, Lost> {
        while let Some(event) = self.conn.poll_for_event().map_err(lost)? {
            let key = match event {
                Event::XinputRawKeyPress(raw) => {
                    u8::try_from(raw.detail).ok().map(|code| RawKey::Press {
                        device: raw.sourceid,
                        code,
                    })
                }
                Event::XinputRawKeyRelease(raw) => {
                    u8::try_from(raw.detail).ok().map(|code| RawKey::Release {
                        device: raw.sourceid,
                        code,
                    })
                }
                Event::XinputHierarchy(_) => Some(RawKey::HierarchyChanged),
                _ => None,
            };
            if key.is_some() {
                return Ok(key);
            }
        }
        Ok(None)
    }

    fn describe(&mut self, device: u16) -> Option<DeviceFacts> {
        let info = self
            .conn
            .xinput_xi_query_device(device)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.infos.into_iter().find(|info| info.deviceid == device))?;
        let xtest_property = match self.xtest_atom() {
            Some(atom) => self.has_property(device, atom),
            None => Some(false),
        };
        Some(DeviceFacts {
            slave_keyboard: info.type_ == DeviceType::SLAVE_KEYBOARD,
            name: info.name,
            xtest_property,
        })
    }

    fn answers(&mut self) -> bool {
        self.conn
            .get_input_focus()
            .is_ok_and(|cookie| cookie.reply().is_ok())
    }
}
