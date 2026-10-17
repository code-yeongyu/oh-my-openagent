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
    Focus(Window),
    Warp(i16, i16),
    /// One probe of whether another client holds the pointer.
    HeldProbe,
}

pub struct FakeInputServer {
    pub calls: RefCell<Vec<Call>>,
    pub active: Cell<Option<Window>>,
    pub focus: Cell<Window>,
    pub pointer: Cell<(i16, i16)>,
    pub pointer_after_flush: Cell<Option<(i16, i16)>>,
    pub focus_after_input: Cell<Option<Window>>,
    /// How many `pointer_held` probes still answer held (a window manager
    /// replaying grabbed presses); `usize::MAX` never releases.
    pub held_probes: Cell<usize>,
    /// How many `pointer_within` probes still answer that another window
    /// covers the point; `usize::MAX` never uncovers it.
    pub covered_probes: Cell<usize>,
    activate_updates_active: Cell<bool>,
    classes: HashMap<Window, Vec<u8>>,
    origins: HashMap<Window, (i16, i16)>,
    /// A child window covering the whole of its parent (the widget a toolkit
    /// dispatches to), keyed by parent.
    children: HashMap<Window, Window>,
    parents: HashMap<Window, Window>,
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
            focus: Cell::new(active.unwrap_or(ROOT)),
            pointer: Cell::new((0, 0)),
            pointer_after_flush: Cell::new(None),
            focus_after_input: Cell::new(None),
            held_probes: Cell::new(0),
            covered_probes: Cell::new(0),
            activate_updates_active: Cell::new(true),
            classes: HashMap::new(),
            origins: HashMap::new(),
            children: HashMap::new(),
            parents: HashMap::new(),
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
        self.parents.insert(child, parent);
        self
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }

    pub fn without_ewmh_activation(self) -> Self {
        self.activate_updates_active.set(false);
        self
    }

    fn input(&self, call: Call) -> CoreResult<()> {
        let index = self.inputs.get();
        self.inputs.set(index + 1);
        if self.fail_at.get() == Some(index) {
            return Err(DesktopError::input_failed("injected failure"));
        }
        if let Call::Fake(FakeInput::Motion { x, y }) = call {
            self.pointer.set((x, y));
        }
        if let Some(window) = self.focus_after_input.get() {
            self.active.set(Some(window));
            self.focus.set(window);
        }
        self.calls.borrow_mut().push(call);
        Ok(())
    }
}

impl InputServer for FakeInputServer {
    fn root(&self) -> Window {
        ROOT
    }

    fn keymap(&self) -> CoreResult<Keymap> {
        Ok(self.keymap.clone())
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

    fn pointer_within(&self, _window: Window) -> CoreResult<bool> {
        Ok(!count_down(&self.covered_probes))
    }

    fn pointer_held(&self) -> CoreResult<bool> {
        self.calls.borrow_mut().push(Call::HeldProbe);
        Ok(count_down(&self.held_probes))
    }

    fn active_window(&self) -> Option<Window> {
        self.active.get()
    }

    fn activate(&self, window: Window) -> CoreResult<()> {
        self.calls.borrow_mut().push(Call::Activate(window));
        if self.activate_updates_active.get() {
            self.active.set(Some(window));
            self.focus.set(window);
        }
        Ok(())
    }

    fn focus_window(&self) -> CoreResult<Window> {
        Ok(self.focus.get())
    }

    fn set_focus(&self, window: Window) -> CoreResult<()> {
        self.calls.borrow_mut().push(Call::Focus(window));
        self.focus.set(window);
        Ok(())
    }

    fn parent(&self, window: Window) -> CoreResult<Option<Window>> {
        Ok(self.parents.get(&window).copied())
    }

    fn wm_class(&self, window: Window) -> Option<Vec<u8>> {
        self.classes.get(&window).cloned()
    }

    fn flush(&self) -> CoreResult<()> {
        if let Some(point) = self.pointer_after_flush.take() {
            self.pointer.set(point);
        }
        Ok(())
    }
}

/// Whether `remaining` probes are left, spending one (`usize::MAX` never runs out).
fn count_down(remaining: &Cell<usize>) -> bool {
    let left = remaining.get();
    if left != usize::MAX && left > 0 {
        remaining.set(left - 1);
    }
    left > 0
}
