//! The live stop listener on Windows (d-windows.md '## Capture guard and input lock'): a dedicated
//! thread runs `WH_KEYBOARD_LL`, re-installed every 500 ms new-before-old so a silently removed hook
//! leaves no gap, plus the `RegisterHotKey` backstop. The hook procedure takes no lock, allocates
//! nothing and does no I/O: it classifies the event (the same rule as [`super::HookEvent::origin`]),
//! updates atomics and returns. A listener whose hook AND hotkey both failed is DEAF.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use omo_computer_core::backend::{BackendResult, Refusal, StopListener};
use omo_computer_core::error::{EngineCode, Reason};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, KillTimer, PeekMessageW, SetTimer, SetWindowsHookExW, UnhookWindowsHookEx,
    WaitMessage, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, PM_REMOVE, WH_KEYBOARD_LL, WM_HOTKEY,
    WM_KEYDOWN, WM_SYSKEYDOWN, WM_TIMER,
};

use super::{
    is_chord, normalize_vk, HookEvent, HotkeyVerdict, Origin, PhysicalChord, Sightings, VK_ESCAPE,
};

/// The `RegisterHotKey` id of the stop chord backstop.
const HOTKEY_ID: i32 = 0x5E01;
/// The hook is re-installed on this beat.
const REINSTALL: Duration = Duration::from_millis(500);

/// What the hook procedure writes and the listener reads.
struct Shared {
    stop: AtomicBool,
    deaf: AtomicBool,
    /// One bit per virtual key the user holds physically (generic modifier codes).
    held: [AtomicU64; 4],
    /// One bit per virtual key an injector holds down (ours or another's).
    injected_held: [AtomicU64; 4],
    physical_sighting: AtomicU64,
    injected_sighting: AtomicU64,
}

static SHARED: Shared = Shared {
    stop: AtomicBool::new(false),
    deaf: AtomicBool::new(false),
    held: [
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
    ],
    injected_held: [
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
    ],
    physical_sighting: AtomicU64::new(0),
    injected_sighting: AtomicU64::new(0),
};

fn set_bit(set: &[AtomicU64; 4], vk: u16, down: bool) {
    let word = &set[usize::from(vk / 64) & 3];
    let bit = 1u64 << (vk % 64);
    if down {
        word.fetch_or(bit, Ordering::Relaxed);
    } else {
        word.fetch_and(!bit, Ordering::Relaxed);
    }
}

fn bit(set: &[AtomicU64; 4], vk: u16) -> bool {
    set[usize::from(vk / 64) & 3].load(Ordering::Relaxed) & (1u64 << (vk % 64)) != 0
}

fn is_held(vk: u16) -> bool {
    bit(&SHARED.held, vk)
}

unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        // SAFETY: for WH_KEYBOARD_LL, lParam points to a KBDLLHOOKSTRUCT for the call's duration.
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let event = HookEvent {
            vk: u16::try_from(info.vkCode).unwrap_or(0),
            down: matches!(
                u32::try_from(wparam.0).unwrap_or(0),
                WM_KEYDOWN | WM_SYSKEYDOWN
            ),
            injected: info.flags.0 & LLKHF_INJECTED.0 != 0,
            extra_info: info.dwExtraInfo,
            time: u64::from(info.time),
        };
        let origin = event.origin();
        // Left/right modifier codes are folded to the generic ones (review H1 of #13350).
        let set = if origin == Origin::Physical {
            &SHARED.held
        } else {
            &SHARED.injected_held
        };
        set_bit(set, normalize_vk(event.vk), event.down);
        let chord = is_chord(&event, |vk| bit(set, vk));
        if chord {
            match origin {
                Origin::Physical => {
                    SHARED
                        .physical_sighting
                        .store(event.time, Ordering::Relaxed);
                    SHARED.stop.store(true, Ordering::Release);
                }
                Origin::Ours | Origin::Foreign => SHARED
                    .injected_sighting
                    .store(event.time, Ordering::Relaxed),
            }
        }
    }
    // SAFETY: passing the event on is the documented contract of a hook procedure.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn install() -> Option<HHOOK> {
    // SAFETY: a low-level hook needs no module handle for a procedure in this process.
    unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard),
            Some(HINSTANCE::default()),
            0,
        )
    }
    .ok()
}

fn on_hotkey(now: u64) {
    let mut sightings = Sightings::default();
    let physical = SHARED.physical_sighting.load(Ordering::Relaxed);
    let injected = SHARED.injected_sighting.load(Ordering::Relaxed);
    if physical >= injected && physical != 0 {
        sightings.record(Origin::Physical, physical);
    } else if injected != 0 {
        sightings.record(Origin::Foreign, injected);
    }
    if sightings.on_hotkey(now) == HotkeyVerdict::BackstopStop {
        SHARED.stop.store(true, Ordering::Release);
    }
}

fn run() {
    let mut hook = install();
    // SAFETY: a thread-bound hotkey; WM_HOTKEY arrives on this thread's queue.
    let hotkey = unsafe {
        RegisterHotKey(
            None,
            HOTKEY_ID,
            MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
            u32::from(VK_ESCAPE),
        )
    }
    .is_ok();
    SHARED
        .deaf
        .store(hook.is_none() && !hotkey, Ordering::Release);
    let interval = u32::try_from(REINSTALL.as_millis()).unwrap_or(500);
    // SAFETY: a thread timer; WM_TIMER arrives on this thread's queue.
    let timer = unsafe { SetTimer(None, 0, interval, None) };
    let mut message = MSG::default();
    loop {
        // SAFETY: blocks until a message (input-hook callbacks run inside this wait).
        if unsafe { WaitMessage() }.is_err() {
            break;
        }
        // SAFETY: drains this thread's queue.
        while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
            match message.message {
                WM_TIMER => {
                    let fresh = install();
                    if let Some(old) = hook.take() {
                        // SAFETY: the hook installed by this thread.
                        let _ = unsafe { UnhookWindowsHookEx(old) };
                    }
                    hook = fresh;
                    SHARED
                        .deaf
                        .store(hook.is_none() && !hotkey, Ordering::Release);
                }
                WM_HOTKEY if message.wParam.0 == usize::try_from(HOTKEY_ID).unwrap_or(0) => {
                    on_hotkey(u64::from(message.time))
                }
                _ => {}
            }
        }
    }
    // SAFETY: the timer of this thread.
    let _ = unsafe { KillTimer(None, timer) };
}

/// The stop listener the backend hands out.
pub struct HookListener {
    _alive: Arc<()>,
}

impl HookListener {
    /// Starts the listener thread.
    #[must_use]
    pub fn start() -> Self {
        std::thread::Builder::new()
            .name("omo-computer-stop-hook".to_owned())
            .spawn(run)
            .ok();
        Self {
            _alive: Arc::new(()),
        }
    }

    /// The keys the user holds physically right now.
    #[must_use]
    pub fn physical(&self) -> PhysicalChord {
        let mut chord = PhysicalChord::default();
        for vk in 0..=255u16 {
            if is_held(vk) {
                chord.on_key(&HookEvent {
                    vk,
                    down: true,
                    injected: false,
                    extra_info: 0,
                    time: 0,
                });
            }
        }
        chord
    }
}

/// The refusal of every exec while the listener cannot hear (d-windows.md, Deafness).
pub const DEAF: Refusal = Refusal::new(EngineCode::StopPathUnavailable, Reason::Deaf.wire());

impl StopListener for HookListener {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        if SHARED.deaf.load(Ordering::Acquire) {
            return Err(DEAF);
        }
        Ok(SHARED.stop.swap(false, Ordering::AcqRel))
    }
}
