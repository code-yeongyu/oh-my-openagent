//! The compositor's keymap, from the libei keyboard's keymap fd, and the stroke that types a
//! character or a named key in the ACTIVE group only - never a glyph borrowed from another
//! group (d-linux.md 'Typing'). libxkbcommon does the keymap work; this module only asks it.

mod native;

use native::Native;

/// A key as libei sends it: an evdev code (the XKB keycode minus 8) plus the modifiers that
/// select its level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stroke {
    pub key: u32,
    pub shift: Option<u32>,
    pub level3: Option<u32>,
}

/// Why a stroke could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unresolved {
    /// No key of the active group produces the character.
    Glyph { grapheme: String, group: String },
    /// The name is not a key this backend knows.
    UnknownKey(String),
}

const XKB_EVDEV_OFFSET: u32 = 8;
const KEYSYM_SHIFT_L: u32 = 0xffe1;
const KEYSYM_ISO_LEVEL3_SHIFT: u32 = 0xfe03;

/// One compiled keymap.
pub struct Keymap {
    native: Native,
    layouts: Vec<String>,
    shift: Option<u32>,
    level3: Option<u32>,
}

impl Keymap {
    /// Compiles the keymap text the compositor fed; `None` when it does not compile or the
    /// library is missing.
    #[must_use]
    pub fn compile(text: &str) -> Option<Self> {
        let native = Native::compile(text)?;
        let layouts = native.layouts();
        let shift = native.mod_mask("Shift");
        let level3 = native.mod_mask("Mod5");
        Some(Self {
            native,
            layouts,
            shift,
            level3,
        })
    }

    #[must_use]
    pub fn layouts(&self) -> &[String] {
        &self.layouts
    }

    /// The name of `group`, as the keymap declares it.
    #[must_use]
    pub fn group_name(&self, group: u32) -> String {
        usize::try_from(group)
            .ok()
            .and_then(|index| self.layouts.get(index))
            .cloned()
            .unwrap_or_else(|| format!("group {}", group + 1))
    }

    /// The stroke for `ch` in `group`.
    ///
    /// # Errors
    /// [`Unresolved::Glyph`] naming the active group.
    pub fn resolve_char(&mut self, ch: char, group: u32) -> Result<Stroke, Unresolved> {
        let keysym = xkeysym::Keysym::from_char(ch).raw();
        self.resolve_keysym(keysym, group)
            .ok_or_else(|| Unresolved::Glyph {
                grapheme: ch.to_string(),
                group: self.group_name(group),
            })
    }

    /// The key for a named key (`shift`, `enter`, `f5`) or a one-character key (`a`) in `group`.
    ///
    /// # Errors
    /// [`Unresolved::UnknownKey`] for a name no key carries; [`Unresolved::Glyph`] for a
    /// one-character key the active group lacks.
    pub fn resolve_key(&mut self, name: &str, group: u32) -> Result<u32, Unresolved> {
        if let Some(keysym) = named_keysym(&name.to_ascii_lowercase()) {
            return self
                .resolve_keysym(keysym, group)
                .map(|stroke| stroke.key)
                .ok_or_else(|| Unresolved::UnknownKey(name.to_owned()));
        }
        let mut chars = name.chars();
        match (chars.next(), chars.next()) {
            (Some(ch), None) => self
                .resolve_char(ch.to_lowercase().next().unwrap_or(ch), group)
                .map(|stroke| stroke.key),
            _ => Err(Unresolved::UnknownKey(name.to_owned())),
        }
    }

    /// The fewest-modifier stroke producing `keysym` in `group`.
    fn resolve_keysym(&mut self, keysym: u32, group: u32) -> Option<Stroke> {
        let candidates = [
            Some(0),
            self.shift,
            self.level3,
            self.shift
                .zip(self.level3)
                .map(|(shift, level3)| shift | level3),
        ];
        let keycodes = self.native.keycodes();
        for mask in candidates.into_iter().flatten() {
            self.native.set(mask, group);
            let found = keycodes
                .clone()
                .find(|keycode| self.native.keysym(*keycode) == keysym);
            if let Some(keycode) = found {
                let stroke = Stroke {
                    key: keycode - XKB_EVDEV_OFFSET,
                    shift: self.modifier_key(mask, self.shift, KEYSYM_SHIFT_L, group),
                    level3: self.modifier_key(mask, self.level3, KEYSYM_ISO_LEVEL3_SHIFT, group),
                };
                let needed = [(self.shift, stroke.shift), (self.level3, stroke.level3)];
                if needed
                    .iter()
                    .all(|(bit, key)| bit.is_none_or(|bit| mask & bit == 0) || key.is_some())
                {
                    self.native.set(0, group);
                    return Some(stroke);
                }
            }
        }
        self.native.set(0, group);
        None
    }

    /// The evdev code of the key that produces `modifier_keysym`, when `mask` uses `bit`.
    fn modifier_key(
        &mut self,
        mask: u32,
        bit: Option<u32>,
        modifier_keysym: u32,
        group: u32,
    ) -> Option<u32> {
        let bit = bit?;
        if mask & bit == 0 {
            return None;
        }
        self.native.set(0, group);
        let found = self
            .native
            .keycodes()
            .find(|keycode| self.native.keysym(*keycode) == modifier_keysym);
        self.native.set(mask, group);
        found.map(|keycode| keycode - XKB_EVDEV_OFFSET)
    }
}

/// The keysym of a named key, in the session's key vocabulary.
fn named_keysym(name: &str) -> Option<u32> {
    let keysym = match name {
        "shift" => KEYSYM_SHIFT_L,
        "ctrl" | "control" => 0xffe3,
        "alt" | "option" => 0xffe9,
        "super" | "meta" | "cmd" | "command" | "win" => 0xffeb,
        "altgr" => KEYSYM_ISO_LEVEL3_SHIFT,
        "enter" | "return" => 0xff0d,
        "tab" => 0xff09,
        "escape" | "esc" => 0xff1b,
        "backspace" => 0xff08,
        "delete" | "del" => 0xffff,
        "insert" => 0xff63,
        "space" => 0x20,
        "home" => 0xff50,
        "end" => 0xff57,
        "pageup" => 0xff55,
        "pagedown" => 0xff56,
        "left" => 0xff51,
        "up" => 0xff52,
        "right" => 0xff53,
        "down" => 0xff54,
        _ => {
            return name
                .strip_prefix('f')
                .and_then(|n| n.parse::<u32>().ok())
                .filter(|n| (1..=24).contains(n))
                .map(|n| 0xffbe + n - 1)
        }
    };
    Some(keysym)
}
