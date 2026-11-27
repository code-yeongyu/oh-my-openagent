//! The `WH_KEYBOARD_LL` hook of the kill switch. It runs on the listener
//! thread (the system calls it from that thread's message wait), sees every
//! key event with `LLKHF_INJECTED` set for synthesized ones, and never
//! swallows a key. Unlike `RegisterHotKey`, any number of processes can hook
//! at once, so every session's engine arms its own stop.
//!
//! The procedure only reads the event, updates [`PhysicalChord`] and, on a
//! physical chord, refuses input in memory and wakes the stop-commit worker:
//! nothing in it blocks, so the system's hook timeout is never reached.
//!
//! Every inaccuracy errs toward an extra stop, never a missed one: while the
//! hook is blind (dropped by the system and not yet re-installed, or an
//! elevated window has focus) the `RegisterHotKey` backstop stops on any
//! chord, injected ones included; and a modifier released while the hook was
//! blind stays counted as held until it is pressed and released again.

use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use super::chord::Hotkey;
use super::listener::Shared;
use super::physical::{hotkey_needs_stop, KeyEvent, Outcome, PhysicalChord, TriggerSeen};

struct State {
    shared: Arc<Shared>,
    chord: PhysicalChord,
    trigger: Option<TriggerSeen>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

/// Points this thread's hook procedure at `shared` and `hotkey`.
pub(super) fn arm(shared: &Arc<Shared>, hotkey: Hotkey) {
    STATE.with(|state| {
        *state.borrow_mut() = Some(State {
            shared: Arc::clone(shared),
            chord: PhysicalChord::new(hotkey),
            trigger: None,
        });
    });
}

pub(super) fn disarm() {
    STATE.with(|state| state.borrow_mut().take());
}

/// Whether a `WM_HOTKEY` must stop input; consumes the trigger the hook saw.
pub(super) fn take_hotkey_decision() -> bool {
    STATE.with(|state| {
        let Ok(mut state) = state.try_borrow_mut() else {
            return true;
        };
        let seen = state.as_mut().and_then(|state| state.trigger.take());
        hotkey_needs_stop(seen, Instant::now())
    })
}

fn observe(event: KeyEvent) {
    STATE.with(|state| {
        // A re-entrant call cannot happen on this thread; if it ever did,
        // skipping one event beats unwinding across the FFI boundary.
        let Ok(mut state) = state.try_borrow_mut() else {
            return;
        };
        let Some(state) = state.as_mut() else {
            return;
        };
        match state.chord.key(event) {
            Outcome::Stop => {
                state.shared.request_stop();
                state.trigger = Some(TriggerSeen { at: Instant::now(), injected: false, stopped: true });
            }
            Outcome::InjectedTrigger => {
                state.shared.injected_ignored();
                state.trigger = Some(TriggerSeen { at: Instant::now(), injected: true, stopped: false });
            }
            Outcome::Other if event.down && event.vk == state.chord.trigger_vk() && !event.injected => {
                state.trigger = Some(TriggerSeen { at: Instant::now(), injected: false, stopped: false });
            }
            Outcome::Other => {}
        }
    });
}

unsafe extern "system" fn procedure(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && lparam != 0 {
        // SAFETY: [FFI] for HC_ACTION the system passes a valid
        // `KBDLLHOOKSTRUCT` that lives for the duration of this call.
        let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        let message = u32::try_from(wparam).unwrap_or(0);
        observe(KeyEvent {
            vk: info.vkCode,
            down: message == WM_KEYDOWN || message == WM_SYSKEYDOWN,
            injected: info.flags & LLKHF_INJECTED != 0,
        });
    }
    // SAFETY: [FFI] forwards the unchanged arguments; the hook handle is
    // ignored by the system for low-level hooks.
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}

/// Hooks this process has installed and not yet removed.
pub(super) static INSTALLED: AtomicUsize = AtomicUsize::new(0);

/// One installed hook; unhooked on drop.
pub(super) struct Hook(HHOOK);

impl Hook {
    /// Installs a hook bound to this thread's message wait, or `None` when
    /// the system refuses.
    pub(super) fn install() -> Option<Self> {
        // SAFETY: [FFI] a null name returns this executable's handle.
        let module = unsafe { GetModuleHandleW(std::ptr::null()) };
        // SAFETY: [FFI] `procedure` is a 'static `extern "system"` function;
        // thread id 0 with a module handle is the documented form for
        // low-level hooks.
        let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(procedure), module, 0) };
        if hook.is_null() {
            return None;
        }
        INSTALLED.fetch_add(1, Ordering::SeqCst);
        Some(Self(hook))
    }
}

impl Drop for Hook {
    fn drop(&mut self) {
        // SAFETY: [FFI] the handle came from `SetWindowsHookExW` and is
        // unhooked exactly once.
        if unsafe { UnhookWindowsHookEx(self.0) } == 0 {
            eprintln!("senpi-desktop: UnhookWindowsHookEx failed");
        }
        INSTALLED.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
#[path = "hook_tests.rs"]
mod tests;
