//! The EWMH client list read from the live server: stacking order, titles, `WM_CLASS`,
//! `_NET_WM_PID`, `_NET_ACTIVE_WINDOW` and `_NET_WM_DESKTOP`.

use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

use super::connection::X11Connection;
use super::server::{ClientWindow, XError, XServer};

/// `WM_CLASS` is `instance\0class\0`; the class names the application.
#[must_use]
pub fn wm_class(value: &[u8]) -> String {
    let mut parts = value.split(|&byte| byte == 0).filter(|part| !part.is_empty());
    let instance = parts.next();
    parts
        .next()
        .or(instance)
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .unwrap_or_default()
}

impl X11Connection {
    fn words(&self, window: u32, property: u32, kind: u32) -> Result<Option<Vec<u32>>, XError> {
        let reply = self.conn.get_property(false, window, property, kind, 0, 4096)?.reply()?;
        Ok(reply.value32().map(Iterator::collect).filter(|words: &Vec<u32>| !words.is_empty()))
    }

    fn bytes(&self, window: u32, property: u32, kind: u32) -> Result<Option<Vec<u8>>, XError> {
        let reply = self.conn.get_property(false, window, property, kind, 0, 4096)?.reply()?;
        Ok((!reply.value.is_empty()).then_some(reply.value))
    }

    fn title(&self, window: u32) -> Result<String, XError> {
        let name = self.bytes(window, self.atom("_NET_WM_NAME")?, self.atom("UTF8_STRING")?)?;
        let name = match name {
            Some(name) => Some(name),
            None => self.bytes(window, AtomEnum::WM_NAME.into(), AtomEnum::ANY.into())?,
        };
        Ok(name.map(|value| String::from_utf8_lossy(&value).into_owned()).unwrap_or_default())
    }

    fn client(&self, xid: u32, active: Option<u32>) -> Result<Option<ClientWindow>, XError> {
        let Some(placement) = self.window_placement(xid)? else {
            return Ok(None);
        };
        let class = self
            .bytes(xid, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into())?
            .map(|value| wm_class(&value))
            .unwrap_or_default();
        let first = |words: Option<Vec<u32>>| words.and_then(|words| words.first().copied());
        let cardinal = AtomEnum::CARDINAL.into();
        Ok(Some(ClientWindow {
            xid,
            title: self.title(xid)?,
            class,
            pid: first(self.words(xid, self.atom("_NET_WM_PID")?, cardinal)?),
            focused: active == Some(xid),
            desktop: first(self.words(xid, self.atom("_NET_WM_DESKTOP")?, cardinal)?),
            placement,
        }))
    }

    pub(super) fn read_clients(&self) -> Result<Vec<ClientWindow>, XError> {
        let root = self.screen().root;
        let window = AtomEnum::WINDOW.into();
        let mut ids = match self.words(root, self.atom("_NET_CLIENT_LIST_STACKING")?, window)? {
            Some(ids) => ids,
            None => self.words(root, self.atom("_NET_CLIENT_LIST")?, window)?.unwrap_or_default(),
        };
        ids.reverse();
        let active = self
            .words(root, self.atom("_NET_ACTIVE_WINDOW")?, window)?
            .and_then(|words| words.first().copied())
            .filter(|&id| id != 0);
        let mut clients = Vec::with_capacity(ids.len());
        for xid in ids {
            if let Some(client) = self.client(xid, active)? {
                clients.push(client);
            }
        }
        Ok(clients)
    }
}

#[cfg(test)]
mod tests {
    use super::wm_class;

    #[test]
    fn wm_class_names_the_class_else_the_instance() {
        assert_eq!(wm_class(b"xterm\0XTerm\0"), "XTerm");
        assert_eq!(wm_class(b"solo\0"), "solo");
        assert_eq!(wm_class(b""), "");
    }
}
