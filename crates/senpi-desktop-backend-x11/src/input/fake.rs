//! Recording `InputServer` for the unit tests: every input request lands in
//! `calls` in order, activation takes effect at once, and one input request
//! can be made to fail.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::Window;
use xkeysym::Keysym;

use super::keys::Keymap;
use super::server::{FakeInput, InputServer, SentEvent};

pub const ROOT: Window = 1;
pub const KEY_A: u8 = 8;
pub const KEY_C: u8 = 9;
pub const KEY_ESCAPE: u8 = 11;
pub const KEY_CONTROL_L: u8 = 12;
pub const KEY_SHIFT_L: u8 = 13;
pub const KEY_ALT_L: u8 = 14;
pub const KEY_SHIFT_R: u8 = 17;

/// Two keysyms per keycode from keycode 8: `(unshifted, shifted)`.
const ROWS: [(Keysym, Keysym); 11] = [
    (Keysym::a, Keysym::A),
    (Keysym::c, Keysym::C),
    (Keysym::_1, Keysym::exclam),
    (Keysym::Escape, Keysym::NoSymbol),
    (Keysym::Control_L, Keysym::NoSymbol),
    (Keysym::Shift_L, Keysym::NoSymbol),
    (Keysym::Alt_L, Keysym::Meta_L),
    (Keysym::Super_L, Keysym::NoSymbol),
    (Keysym::Return, Keysym::NoSymbol),
    (Keysym::Shift_R, Keysym::NoSymbol),
    (Keysym::Control_R, Keysym::NoSymbol),
];

pub fn keymap() -> Keymap {
    Keymap {
        min_keycode: 8,
        keysyms_per_keycode: 2,
        keysyms: ROWS
            .iter()
            .flat_map(|(plain, shifted)| [plain.raw(), shifted.raw()])
            .collect(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Call {
    Fake(FakeInput),
    Send(Window, SentEvent),
    Activate(Window),
    Warp(i16, i16),
}

pub struct FakeInputServer {
    pub calls: RefCell<Vec<Call>>,
    pub active: Cell<Option<Window>>,
    pub pointer: Cell<(i16, i16)>,
    classes: HashMap<Window, Vec<u8>>,
    origins: HashMap<Window, (i16, i16)>,
    /// A child window covering the whole of its parent (the widget a toolkit
    /// dispatches to), keyed by parent.
    children: HashMap<Window, Window>,
    keymap: Keymap,
    /// The 0-based index of the input request (fake/send) that fails.
    pub fail_at: Cell<Option<usize>>,
    inputs: Cell<usize>,
}

impl FakeInputServer {
    /// An EWMH window manager with `active` active.
    pub fn new(active: Option<Window>) -> Self {
        Self {
            calls: RefCell::default(),
            active: Cell::new(active),
            pointer: Cell::new((0, 0)),
            classes: HashMap::new(),
            origins: HashMap::new(),
            children: HashMap::new(),
            keymap: keymap(),
            fail_at: Cell::new(None),
            inputs: Cell::new(0),
        }
    }

    /// A client window at root `origin` with raw `WM_CLASS` bytes.
    pub fn window(mut self, window: Window, origin: (i16, i16), wm_class: &[u8]) -> Self {
        self.origins.insert(window, origin);
        self.classes.insert(window, wm_class.to_vec());
        self
    }

    /// `child` covers all of `parent` and receives events sent under it.
    pub fn child(mut self, parent: Window, child: Window) -> Self {
        let origin = self.origins.get(&parent).copied().unwrap_or((0, 0));
        self.origins.insert(child, origin);
        self.children.insert(parent, child);
        self
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }

    fn input(&self, call: Call) -> CoreResult<()> {
        let index = self.inputs.get();
        self.inputs.set(index + 1);
        if self.fail_at.get() == Some(index) {
            return Err(DesktopError::input_failed("injected failure"));
        }
        self.calls.borrow_mut().push(call);
        Ok(())
    }
}

impl InputServer for FakeInputServer {
    fn root(&self) -> Window {
        ROOT
    }

    fn keymap(&self) -> &Keymap {
        &self.keymap
    }

    fn fake(&self, input: FakeInput) -> CoreResult<()> {
        self.input(Call::Fake(input))
    }

    fn send(&self, window: Window, event: SentEvent) -> CoreResult<()> {
        self.input(Call::Send(window, event))
    }

    fn translate(&self, window: Window, x: i16, y: i16) -> CoreResult<(i16, i16)> {
        let (left, top) = self.origins.get(&window).copied().unwrap_or((0, 0));
        Ok((x - left, y - top))
    }

    fn target_at(&self, window: Window, _x: i16, _y: i16) -> CoreResult<Window> {
        let mut current = window;
        while let Some(&child) = self.children.get(&current) {
            current = child;
        }
        Ok(current)
    }

    fn pointer(&self) -> CoreResult<(i16, i16)> {
        Ok(self.pointer.get())
    }

    fn warp(&self, x: i16, y: i16) -> CoreResult<()> {
        self.calls.borrow_mut().push(Call::Warp(x, y));
        self.pointer.set((x, y));
        Ok(())
    }

    fn active_window(&self) -> Option<Window> {
        self.active.get()
    }

    fn activate(&self, window: Window) -> CoreResult<()> {
        self.calls.borrow_mut().push(Call::Activate(window));
        self.active.set(Some(window));
        Ok(())
    }

    fn wm_class(&self, window: Window) -> Option<Vec<u8>> {
        self.classes.get(&window).cloned()
    }

    fn flush(&self) -> CoreResult<()> {
        Ok(())
    }
}
