//! Typing into a window that shows another computer or device (Screen
//! Sharing, iPhone Mirroring). Such a client forwards a key event's key code
//! and drops its Unicode text, so text goes out as the keys of the user's
//! keyboard layout, mapped in full before anything is posted (ported from
//! oh-my-pi `desktop/macos/process.rs` and `input.rs` at 0838d2ab44, MIT).

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use objc2_app_kit::NSRunningApplication;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::keymap::Keystroke;

/// How a client that shows another computer or device forwards input to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RemoteScreen {
    /// Sends each key event's key code to the remote computer (Screen
    /// Sharing), with the modifiers the physical keyboard holds rather than
    /// any the event carries.
    KeyEvents,
    /// Streams HID report state, modifier keys included, to a paired device
    /// (iPhone Mirroring), which misses a key or button transition shorter
    /// than its report interval.
    HidReports,
}

/// Remote-screen linkage of the executables processes run, keyed by pid and
/// executable path so a reused pid is read afresh.
type LinkageCache = Mutex<HashMap<(libc::pid_t, PathBuf), Option<RemoteScreen>>>;

/// Every input event classifies its target, so each process's executable is
/// read once.
static LINKAGE: LazyLock<LinkageCache> = LazyLock::new(LinkageCache::default);
/// Processes whose linkage is kept before the cache starts over.
const MAX_CACHED_LINKAGES: usize = 64;

/// Whether `pid` shows a remote screen. Such a client forwards a key event's
/// key code and ignores its Unicode text.
pub(crate) fn remote_screen(pid: libc::pid_t) -> Option<RemoteScreen> {
    let bundle = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|app| app.bundleIdentifier())
        .map(|bundle| bundle.to_string());
    classify_remote_screen(bundle.as_deref(), || {
        cached_linkage(&LINKAGE, pid, executable_path(pid)?, |executable| {
            linked_dylibs(&mut File::open(executable).ok()?)
        })
    })
}

/// Apple's own clients are known by bundle identifier, so an executable that
/// cannot be read (replaced by an update, say) never hides them; any other
/// application is judged by the Apple screen-sharing framework it links.
fn classify_remote_screen(
    bundle: Option<&str>,
    linkage: impl FnOnce() -> Option<RemoteScreen>,
) -> Option<RemoteScreen> {
    match bundle {
        Some("com.apple.ScreenSharing") => Some(RemoteScreen::KeyEvents),
        Some("com.apple.ScreenContinuity") => Some(RemoteScreen::HidReports),
        _ => linkage(),
    }
}

/// The linkage `cache` holds for `pid` running `executable`, otherwise the
/// one `linked_dylibs` reads. An executable that cannot be read is not kept,
/// so the next event reads it again.
fn cached_linkage(
    cache: &LinkageCache,
    pid: libc::pid_t,
    executable: PathBuf,
    linked_dylibs: impl FnOnce(&Path) -> Option<Vec<Vec<u8>>>,
) -> Option<RemoteScreen> {
    let key = (pid, executable);
    if let Some(&linkage) = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(&key) {
        return linkage;
    }
    let linkage = remote_screen_linkage(&linked_dylibs(&key.1)?);
    let mut cache = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if cache.len() >= MAX_CACHED_LINKAGES {
        cache.clear();
    }
    cache.insert(key, linkage);
    linkage
}

fn remote_screen_linkage(dylibs: &[Vec<u8>]) -> Option<RemoteScreen> {
    let links = |framework: &[u8]| dylibs.iter().any(|dylib| dylib.windows(framework.len()).any(|part| part == framework));
    if links(b"/ScreenSharingKit.framework/") {
        Some(RemoteScreen::HidReports)
    } else if links(b"/ScreenSharing.framework/") {
        Some(RemoteScreen::KeyEvents)
    } else {
        None
    }
}

/// The executable `pid` runs, as the kernel reports it.
fn executable_path(pid: libc::pid_t) -> Option<PathBuf> {
    let mut buffer = vec![0u8; 4096];
    // SAFETY: [FFI] `proc_pidpath` writes at most the supplied buffer size into
    // a buffer that outlives the call.
    let length = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), 4096) };
    let length = usize::try_from(length).ok().filter(|length| *length > 0)?;
    buffer.truncate(length);
    Some(PathBuf::from(String::from_utf8(buffer).ok()?))
}

const FAT_MAGIC: u32 = 0xcafe_babe;
const FAT_MAGIC_64: u32 = 0xcafe_babf;
const MH_MAGIC_64: u32 = 0xfeed_facf;
#[cfg(target_arch = "aarch64")]
const NATIVE_CPU_TYPE: u32 = 0x0100_000c;
#[cfg(not(target_arch = "aarch64"))]
const NATIVE_CPU_TYPE: u32 = 0x0100_0007;
/// `LC_LOAD_DYLIB` and its weak, re-export, lazy and upward variants.
const DYLIB_COMMANDS: [u32; 5] = [0xc, 0x8000_0018, 0x8000_001f, 0x20, 0x8000_0023];
/// Bounds the load-command read of a malformed executable.
const MAX_LOAD_COMMANDS: usize = 1 << 20;

/// Install names of the dylibs a 64-bit Mach-O executable links, read from
/// the slice for this CPU (or the first slice) of a universal binary.
fn linked_dylibs(file: &mut (impl Read + Seek)) -> Option<Vec<Vec<u8>>> {
    let mut start = [0u8; 8];
    file.read_exact(&mut start).ok()?;
    let slice = match be_u32(&start, 0)? {
        fat @ (FAT_MAGIC | FAT_MAGIC_64) => {
            // `fat_arch` holds a 32-bit offset at 8; `fat_arch_64` a 64-bit one.
            let entry_size = if fat == FAT_MAGIC { 20 } else { 32 };
            let count = usize::try_from(be_u32(&start, 4)?).ok()?.min(16);
            let mut entries = vec![0u8; entry_size * count];
            file.read_exact(&mut entries).ok()?;
            let mut slices = entries.chunks_exact(entry_size);
            let entry = slices.clone().find(|entry| be_u32(entry, 0) == Some(NATIVE_CPU_TYPE)).or_else(|| slices.next())?;
            if fat == FAT_MAGIC {
                u64::from(be_u32(entry, 8)?)
            } else {
                u64::from_be_bytes(entry.get(8..16)?.try_into().ok()?)
            }
        }
        _ => 0,
    };
    // `mach_header_64`: magic at 0, `ncmds` at 16, `sizeofcmds` at 20.
    let mut header = [0u8; 32];
    file.seek(SeekFrom::Start(slice)).ok()?;
    file.read_exact(&mut header).ok()?;
    if le_u32(&header, 0)? != MH_MAGIC_64 {
        return None;
    }
    let size = usize::try_from(le_u32(&header, 20)?).ok()?;
    if size > MAX_LOAD_COMMANDS {
        return None;
    }
    let mut commands = vec![0u8; size];
    file.read_exact(&mut commands).ok()?;
    let mut dylibs = Vec::new();
    let mut rest = commands.as_slice();
    for _ in 0..le_u32(&header, 16)? {
        // Every load command starts with its kind and total size; a dylib
        // command's install name sits at the offset stored at 8.
        let length = usize::try_from(le_u32(rest, 4)?).ok()?;
        let command = rest.get(..length).filter(|_| length >= 8)?;
        if DYLIB_COMMANDS.contains(&le_u32(command, 0)?) {
            let name = command.get(usize::try_from(le_u32(command, 8)?).ok()?..)?;
            dylibs.push(name.split(|&byte| byte == 0).next()?.to_vec());
        }
        rest = &rest[length..];
    }
    Some(dylibs)
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// One key of the user's layout that types one character of the text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TypedKey<'a> {
    pub(crate) stroke: Keystroke,
    /// The text this key types, as the event's payload for clients that read it.
    pub(crate) text: &'a str,
}

/// Pause after each key transition.
pub(crate) const KEY_GAP: Duration = Duration::from_millis(8);
/// Key pacing for a device that samples HID report state, which loses a key
/// transition shorter than its report interval; a search field that reacts
/// to every key needs more than one interval.
pub(crate) const REPORT_KEY_GAP: Duration = Duration::from_millis(120);

/// Pause after each key transition for `remote`.
pub(crate) const fn key_gap(remote: RemoteScreen) -> Duration {
    match remote {
        RemoteScreen::HidReports => REPORT_KEY_GAP,
        RemoteScreen::KeyEvents => KEY_GAP,
    }
}

/// The lookup `layout` gives for keys into `window`, a remote screen. A
/// layout without Unicode key layout data has none, which refuses rather than
/// report every character as one no key types.
pub(crate) fn remote_layout<S>(window: &DesktopWindow, layout: impl FnOnce() -> CoreResult<Option<S>>) -> CoreResult<S> {
    layout()?.ok_or_else(|| {
        DesktopError::input_failed(format!(
            "window {} ({}) shows a remote screen, which receives key codes, and the current keyboard \
             layout publishes no Unicode key layout data to find them in; nothing was sent; switch to \
             another keyboard layout",
            window.id, window.app,
        ))
    })
}

/// The layout keys that type `text` into `window`, from `stroke`'s lookup.
/// Text no key types fails before anything is posted; CR LF is one Return.
pub(crate) fn typed_keys<'t>(
    window: &DesktopWindow,
    text: &'t str,
    stroke: impl Fn(char) -> Option<Keystroke>,
) -> CoreResult<Vec<TypedKey<'t>>> {
    let mut keys = Vec::with_capacity(text.len());
    let mut untypable: Vec<&str> = Vec::new();
    let mut rest = text;
    while let Some(character) = rest.chars().next() {
        let (piece, character) = if rest.starts_with("\r\n") { (&rest[..2], '\r') } else { (&rest[..character.len_utf8()], character) };
        rest = &rest[piece.len()..];
        if let Some(stroke) = stroke(character) {
            keys.push(TypedKey { stroke, text: piece });
        } else if !untypable.contains(&piece) {
            untypable.push(piece);
        }
    }
    if untypable.is_empty() {
        return Ok(keys);
    }
    Err(DesktopError::invalid_key(format!(
        "window {} ({}) shows a remote screen, which receives key codes and ignores typed text, and no \
         key on the current keyboard layout types {}; nothing was typed",
        window.id,
        window.app,
        untypable.join(" "),
    )))
}

/// The typed characters that need Shift or Option, each once.
pub(crate) fn modified_text<'a>(keys: &[TypedKey<'a>]) -> Vec<&'a str> {
    let mut modified = Vec::new();
    for key in keys {
        if (key.stroke.shift || key.stroke.option) && !modified.contains(&key.text) {
            modified.push(key.text);
        }
    }
    modified
}

/// Screen Sharing sends the remote computer the modifiers the physical
/// keyboard holds, which background input cannot set without shifting the
/// user's own typing.
pub(crate) fn keyboard_modifiers_refusal(window: &DesktopWindow, action: &str) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {} ({}) takes Shift, Option, Control and Command from the physical keyboard, so background \
         input cannot hold them to {action}; nothing was sent",
        window.id, window.app,
    ))
}

pub(crate) const SHIFT_CODE: u16 = 56;
pub(crate) const OPTION_CODE: u16 = 58;

/// Key transitions `(keycode, down)` that press `keys` like a hardware
/// keyboard, holding Shift and Option only while a key needs them.
pub(crate) fn bare_transitions(keys: &[TypedKey<'_>]) -> Vec<(u16, bool)> {
    let mut transitions = Vec::with_capacity(keys.len() * 2 + 2);
    let (mut shift, mut option) = (false, false);
    for key in keys {
        for (held, wanted, code) in [(&mut shift, key.stroke.shift, SHIFT_CODE), (&mut option, key.stroke.option, OPTION_CODE)] {
            if *held != wanted {
                *held = wanted;
                transitions.push((code, wanted));
            }
        }
        transitions.push((key.stroke.code, true));
        transitions.push((key.stroke.code, false));
    }
    if option {
        transitions.push((OPTION_CODE, false));
    }
    if shift {
        transitions.push((SHIFT_CODE, false));
    }
    transitions
}

/// `CGEventFlags` bits of the modifier keys and Caps Lock.
const MODIFIER_FLAGS: u64 = 0x0001_0000 | 0x0002_0000 | 0x0004_0000 | 0x0008_0000 | 0x0010_0000;

/// Whether the physical keyboard holds a modifier key or has Caps Lock on.
pub(crate) const fn holds_modifier(flags: u64) -> bool {
    flags & MODIFIER_FLAGS != 0
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceFlagsState(state: i32) -> u64;
}

/// `kCGEventSourceStateHIDSystemState`.
const HID_SYSTEM_STATE: i32 = 1;

/// The modifier flags the physical keyboard holds now (HID system state).
pub(crate) fn physical_flags() -> u64 {
    // SAFETY: [FFI] a pure read of the HID system's modifier state.
    unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) }
}

/// A check before every key into a Screen Sharing window: the remote computer
/// takes the modifiers the physical keyboard holds, so a held modifier or Caps
/// Lock would shift the keys. Before the first key it refuses with nothing
/// sent; after one it says what may have landed.
pub(crate) fn physical_modifier_check<'a>(window: &'a DesktopWindow, flags: impl Fn() -> u64 + 'a) -> impl FnMut() -> CoreResult<()> + 'a {
    let mut sent = 0;
    move || {
        if holds_modifier(flags()) {
            let why = format!(
                "window {} ({}) gives the keys it forwards the physical keyboard's Shift, Control, Option, \
                 Command and Caps Lock, and one is held or Caps Lock is on",
                window.id, window.app,
            );
            let retry = "retry once no modifier key is held and Caps Lock is off";
            return Err(if sent == 0 {
                DesktopError::background_unavailable(format!("{why}; nothing was sent; {retry}"))
            } else {
                DesktopError::input_failed(format!(
                    "{why}; {sent} key press(es) sent before this may already have landed, and no further \
                     input was sent; inspect the remote screen first, then {retry}"
                ))
            });
        }
        sent += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
