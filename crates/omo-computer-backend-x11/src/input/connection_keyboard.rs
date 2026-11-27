//! The keyboard read of [`InputConnection`]: XKB `GetState` for the active group, XKB `GetMap`
//! for every group's keysyms, and the core and modifier maps for the keycodes that are not free.

use std::collections::BTreeSet;

use x11rb::connection::Connection;
use x11rb::protocol::xkb::{self, ConnectionExt as _};
use x11rb::protocol::xproto::ConnectionExt as _;

use super::connection::{x, InputConnection};
use super::keys::GroupMap;
use super::server::{Keyboard, XError};

impl InputConnection {
    pub(super) fn read_keyboard(&self) -> Result<Keyboard, XError> {
        let core_kbd = xkb::ID::USE_CORE_KBD.into();
        let group = u8::from(
            self.conn
                .xkb_get_state(core_kbd)
                .map_err(x)?
                .reply()
                .map_err(x)?
                .group,
        );
        let (min, max) = (self.conn.setup().min_keycode, self.conn.setup().max_keycode);
        let count = max.saturating_sub(min).saturating_add(1);
        let full = xkb::MapPart::KEY_SYMS;
        let reply = self
            .conn
            .xkb_get_map(
                core_kbd,
                full,
                0u16.into(),
                0,
                0,
                min,
                count,
                0,
                0,
                0,
                0,
                0u16.into(),
                0,
                0,
                0,
                0,
                0,
                0,
            )
            .map_err(x)?
            .reply()
            .map_err(x)?;
        let syms = reply.map.syms_rtrn.unwrap_or_default();
        let mut extra = BTreeSet::new();
        let keys: Vec<Vec<[u32; 2]>> = syms
            .iter()
            .zip(reply.first_key_sym..=u8::MAX)
            .map(|(key, code)| {
                if key.syms.iter().any(|keysym| *keysym != 0) {
                    extra.insert(code);
                }
                let width = usize::from(key.width.max(1));
                let groups = usize::from(key.group_info & 0x0f);
                (0..groups)
                    .map(|g| {
                        [0, 1].map(|level| {
                            if level < width {
                                key.syms.get(g * width + level).copied().unwrap_or(0)
                            } else {
                                0
                            }
                        })
                    })
                    .collect()
            })
            .collect();
        let (width, core) = self.core_rows(min, count)?;
        for (row, code) in core.chunks(usize::from(width.max(1))).zip(min..=u8::MAX) {
            if row.iter().any(|keysym| *keysym != 0) {
                extra.insert(code);
            }
        }
        let modifiers = self
            .conn
            .get_modifier_mapping()
            .map_err(x)?
            .reply()
            .map_err(x)?;
        extra.extend(modifiers.keycodes.into_iter().filter(|code| *code != 0));
        let mut map = GroupMap::new(reply.first_key_sym, keys, &extra);
        map.keys.resize(usize::from(count), Vec::new());
        Ok(Keyboard {
            map,
            group: usize::from(group),
        })
    }
}
