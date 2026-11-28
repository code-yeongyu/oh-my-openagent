//! An in-memory raw-key server: a scripted XI version, a US keymap, physical and XTEST
//! keyboards, and a connection the test can break.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};

use super::server::{DeviceFacts, KeyMap, Lost, RawKey, RawKeyServer};

pub const PHYSICAL: u16 = 3;
pub const XTEST: u16 = 9;
pub const KEY_ESCAPE: u8 = 9;
pub const KEY_CONTROL_L: u8 = 37;
pub const KEY_SHIFT_L: u8 = 50;
pub const KEY_ALT_L: u8 = 64;
pub const KEY_A: u8 = 38;

#[derive(Debug)]
pub struct State {
    pub version: (u16, u16),
    pub queue: VecDeque<RawKey>,
    pub alive: bool,
    pub select_refused: bool,
}

#[derive(Debug, Clone)]
pub struct FakeKeys(Arc<Mutex<State>>);

fn keymap() -> KeyMap {
    let mut keysyms = vec![0_u32; 256];
    for (code, keysym) in [
        (KEY_ESCAPE, 0xff1b),
        (KEY_CONTROL_L, 0xffe3),
        (KEY_SHIFT_L, 0xffe1),
        (KEY_ALT_L, 0xffe9),
        (KEY_A, 0x61),
    ] {
        keysyms[usize::from(code - 8)] = keysym;
    }
    KeyMap {
        min_keycode: 8,
        keysyms_per_keycode: 1,
        keysyms,
    }
}

impl FakeKeys {
    pub fn new(version: (u16, u16)) -> Self {
        Self(Arc::new(Mutex::new(State {
            version,
            queue: VecDeque::new(),
            alive: true,
            select_refused: false,
        })))
    }

    pub fn lock(&self) -> MutexGuard<'_, State> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Presses then releases `codes` in order on `device`, holding them all before releasing.
    pub fn chord(&self, device: u16, codes: &[u8]) {
        let mut state = self.lock();
        for &code in codes {
            state.queue.push_back(RawKey::Press { device, code });
        }
        for &code in codes.iter().rev() {
            state.queue.push_back(RawKey::Release { device, code });
        }
    }

    pub fn boxed(&self) -> Box<dyn RawKeyServer> {
        Box::new(self.clone())
    }
}

impl RawKeyServer for FakeKeys {
    fn xi_version(&mut self) -> Result<(u16, u16), Lost> {
        let state = self.lock();
        if state.alive {
            Ok(state.version)
        } else {
            Err(Lost)
        }
    }

    fn select_raw_keys(&mut self) -> Result<(), Lost> {
        if self.lock().select_refused {
            Err(Lost)
        } else {
            Ok(())
        }
    }

    fn keymap(&mut self) -> Result<KeyMap, Lost> {
        Ok(keymap())
    }

    fn next_raw_key(&mut self) -> Result<Option<RawKey>, Lost> {
        let mut state = self.lock();
        if state.alive {
            Ok(state.queue.pop_front())
        } else {
            Err(Lost)
        }
    }

    fn describe(&mut self, device: u16) -> Option<DeviceFacts> {
        match device {
            PHYSICAL => Some(DeviceFacts {
                slave_keyboard: true,
                name: b"AT Translated Set 2 keyboard".to_vec(),
                xtest_property: Some(false),
            }),
            XTEST => Some(DeviceFacts {
                slave_keyboard: true,
                name: b"Virtual core XTEST keyboard".to_vec(),
                xtest_property: Some(true),
            }),
            _ => None,
        }
    }

    fn answers(&mut self) -> bool {
        self.lock().alive
    }
}
