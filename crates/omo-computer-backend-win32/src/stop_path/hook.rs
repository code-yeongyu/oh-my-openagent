//! The live stop listener on Windows (d-windows.md '## Capture guard and input lock'): a dedicated
//! thread runs `WH_KEYBOARD_LL`, re-installed every 500 ms new-before-old so a silently removed hook
//! leaves no gap, plus the `RegisterHotKey` backstop. The hook procedure takes no lock, allocates
//! nothing and does no I/O: it classifies the event (the same rule as [`super::HookEvent::origin`]),
//! updates atomics and returns. A listener whose hook AND hotkey both failed, or whose thread is
//! not running (never started, or its message loop ended), is DEAF. The thread is started once per
//! process and shared by every listener; each listener reads the stop count through its own
//! [`super::StopCursor`] (review M1 of #13350).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::OnceLock;
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
    is_chord, liveness, normalize_vk, HookEvent, HotkeyVerdict, Liveness, Origin, PhysicalChord,
    Sightings, StopCursor, VK_ESCAPE,
};

/// The `RegisterHotKey` id of the stop chord backstop.
const HOTKEY_ID: i32 = 0x5E01;
/// The hook is re-installed on this beat.
const REINSTALL: Duration = Duration::from_millis(500);
/// How long `start` waits for the thread to report its hook and hotkey before calling it deaf.
const READY: Duration = Duration::from_secs(2);

/// What the hook procedure writes and the listener reads.
struct Shared {
    /// Physical stops (and backstop stops) counted since the process started.
    stops: AtomicU64,
    /// The listener thread's message loop is running.
    running: AtomicBool,
    hook_ok: AtomicBool,
    hotkey_ok: AtomicBool,
    /// One bit per virtual key the user holds physically (generic modifier codes).
    held: [AtomicU64; 4],
    /// One bit per virtual key an injector holds down (ours or another's).
    injected_held: [AtomicU64; 4],
    physical_sighting: AtomicU64,
    injected_sighting: AtomicU64,
}

static SHARED: Shared = Shared {
    stops: AtomicU64::new(0),
    running: AtomicBool::new(false),
    hook_ok: AtomicBool::new(false),
    hotkey_ok: AtomicBool::new(false),
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
                    SHARED.stops.fetch_add(1, Ordering::AcqRel);
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
        SHARED.stops.fetch_add(1, Ordering::AcqRel);
    }
}

fn run(ready: &mpsc::Sender<()>) {
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
    SHARED.hook_ok.store(hook.is_some(), Ordering::Release);
    SHARED.hotkey_ok.store(hotkey, Ordering::Release);
    SHARED.running.store(true, Ordering::Release);
    let _ = ready.send(());
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
                    SHARED.hook_ok.store(hook.is_some(), Ordering::Release);
                }
                WM_HOTKEY if message.wParam.0 == usize::try_from(HOTKEY_ID).unwrap_or(0) => {
                    on_hotkey(u64::from(message.time))
                }
                _ => {}
            }
        }
    }
    // The loop ended: Windows drops this thread's hook and hotkey with it, so every listener is
    // deaf from here on rather than silently never stopping.
    SHARED.running.store(false, Ordering::Release);
    // SAFETY: the timer of this thread.
    let _ = unsafe { KillTimer(None, timer) };
}

/// Starts the one listener thread of the process (once) and waits for its first report.
fn ensure_started() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let (ready, wait) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("omo-computer-stop-hook".to_owned())
            .spawn(move || run(&ready));
        if spawned.is_ok() {
            // A thread that does not report in time leaves `running` false: deaf, not silent.
            let _ = wait.recv_timeout(READY);
        }
    });
}

/// The stop listener the backend hands out: a cursor on the process's one listener thread.
pub struct HookListener {
    cursor: StopCursor,
}

impl HookListener {
    /// Starts the process's listener thread if it is not running yet, and returns a listener that
    /// reports the stops counted from now on.
    #[must_use]
    pub fn start() -> Self {
        ensure_started();
        Self {
            cursor: StopCursor::at(SHARED.stops.load(Ordering::Acquire)),
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
        let state = liveness(
            SHARED.running.load(Ordering::Acquire),
            SHARED.hook_ok.load(Ordering::Acquire),
            SHARED.hotkey_ok.load(Ordering::Acquire),
        );
        if state == Liveness::Deaf {
            return Err(DEAF);
        }
        Ok(self.cursor.take(SHARED.stops.load(Ordering::Acquire)))
    }
}
