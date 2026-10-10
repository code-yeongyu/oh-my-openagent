//! In-memory `XServer` for the unit tests: interned atoms, root/client
//! properties, window placements, and a synthetic root image whose pixel at
//! root `(x, y)` is `rgb(x & 0xff, y & 0xff, 0x7f)`.

use std::cell::RefCell;
use std::collections::HashMap;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::{Atom, AtomEnum, Window};

use super::connection::{Monitor, Placement, Screen, XServer};
use super::image::{ColorMasks, Pixmap, RootRect};

pub(crate) const ROOT: Window = 1;
pub(crate) const MASKS: ColorMasks = ColorMasks {
    red: 0x00ff_0000,
    green: 0x0000_ff00,
    blue: 0x0000_00ff,
};

#[derive(Debug, Clone)]
enum Value {
    Words(Vec<u32>),
    Bytes(Vec<u8>),
}

#[derive(Default)]
pub(crate) struct FakeServer {
    pub width: u32,
    pub height: u32,
    pub monitors: Vec<Monitor>,
    atoms: RefCell<HashMap<String, Atom>>,
    properties: HashMap<(Window, Atom), (Atom, Value)>,
    placements: HashMap<Window, Placement>,
    /// Every `root_image` rectangle, in request order.
    pub requests: RefCell<Vec<RootRect>>,
}

impl FakeServer {
    pub(crate) fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            ..Self::default()
        }
    }

    pub(crate) fn monitor(mut self, name: &str, rect: (i16, i16, u16, u16), primary: bool) -> Self {
        let atom = self.intern(name);
        self.monitors.push(Monitor {
            atom,
            name: name.to_owned(),
            x: rect.0,
            y: rect.1,
            width: rect.2,
            height: rect.3,
            primary,
        });
        self
    }

    pub(crate) fn intern(&self, name: &str) -> Atom {
        let mut atoms = self.atoms.borrow_mut();
        let next = 1000 + u32::try_from(atoms.len()).unwrap_or(u32::MAX);
        *atoms.entry(name.to_owned()).or_insert(next)
    }

    pub(crate) fn root_words(self, property: &str, kind: AtomEnum, words: &[u32]) -> Self {
        self.words_on(ROOT, property, kind.into(), words)
    }

    pub(crate) fn words_on(mut self, window: Window, property: &str, kind: Atom, words: &[u32]) -> Self {
        let property = self.intern(property);
        self.properties
            .insert((window, property), (kind, Value::Words(words.to_vec())));
        self
    }

    pub(crate) fn bytes_on(mut self, window: Window, property: Atom, kind: Atom, bytes: &[u8]) -> Self {
        self.properties
            .insert((window, property), (kind, Value::Bytes(bytes.to_vec())));
        self
    }

    pub(crate) fn window(mut self, window: Window, placement: Placement) -> Self {
        self.placements.insert(window, placement);
        self
    }

    fn value(&self, window: Window, property: Atom, kind: Atom) -> Option<&Value> {
        let (stored_kind, value) = self.properties.get(&(window, property))?;
        (kind == Atom::from(AtomEnum::ANY) || kind == *stored_kind).then_some(value)
    }
}

pub(crate) fn viewable(x: i32, y: i32, width: u32, height: u32) -> Placement {
    Placement {
        viewable: true,
        x,
        y,
        width,
        height,
    }
}

impl XServer for FakeServer {
    fn screen(&self) -> Screen {
        Screen {
            root: ROOT,
            width: self.width,
            height: self.height,
            masks: MASKS,
        }
    }

    fn monitors(&self) -> CoreResult<Vec<Monitor>> {
        Ok(self.monitors.clone())
    }

    fn atom(&self, name: &str) -> CoreResult<Atom> {
        Ok(self.intern(name))
    }

    fn words(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u32>> {
        match self.value(window, property, kind)? {
            Value::Words(words) if !words.is_empty() => Some(words.clone()),
            Value::Words(_) | Value::Bytes(_) => None,
        }
    }

    fn bytes(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u8>> {
        match self.value(window, property, kind)? {
            Value::Bytes(bytes) if !bytes.is_empty() => Some(bytes.clone()),
            Value::Bytes(_) | Value::Words(_) => None,
        }
    }

    fn placement(&self, window: Window) -> Option<Placement> {
        self.placements.get(&window).copied()
    }

    /// LSB-first 32 bpp ZPixmap, like a little-endian Xvfb at depth 24.
    fn root_image(&self, rect: RootRect) -> CoreResult<Pixmap> {
        self.requests.borrow_mut().push(rect);
        let inside = rect.x >= 0
            && rect.y >= 0
            && i64::from(rect.x) + i64::from(rect.width) <= i64::from(self.width)
            && i64::from(rect.y) + i64::from(rect.height) <= i64::from(self.height);
        if !inside {
            return Err(DesktopError::capture_failed(
                "BadMatch: rectangle outside the root",
            ));
        }
        let mut data = Vec::new();
        for y in rect.y..rect.y + i32::try_from(rect.height).unwrap_or(i32::MAX) {
            for x in rect.x..rect.x + i32::try_from(rect.width).unwrap_or(i32::MAX) {
                let [red, green] = [x, y].map(|value| u8::try_from(value & 0xff).unwrap_or(0));
                data.extend_from_slice(&[0x7f, green, red, 0]);
            }
        }
        Ok(Pixmap {
            width: rect.width,
            height: rect.height,
            depth: 24,
            bits_per_pixel: 32,
            scanline_pad: 32,
            lsb_first: true,
            data,
        })
    }
}
