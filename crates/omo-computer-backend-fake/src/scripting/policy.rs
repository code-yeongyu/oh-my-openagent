//! The scripted inputs of the safety and consent rows: secure focus, the self set, held keys,
//! full access, reservations, code identity and the hand identity.

use omo_computer_core::listing::CodeIdentity;

use crate::backend::FakeBackend;
use crate::scenario::HandIdentity;

impl FakeBackend {
    /// The focused element of `window` is a secure field.
    #[must_use]
    pub fn secure_focus(&self, window: &str) -> bool {
        self.lock()
            .scenario
            .secure_focus
            .as_ref()
            .is_some_and(|secure| secure.window == window)
    }

    /// The secure field's role, when one has focus anywhere.
    #[must_use]
    pub fn secure_focus_role(&self) -> Option<String> {
        self.lock()
            .scenario
            .secure_focus
            .as_ref()
            .map(|secure| secure.role.clone())
    }

    /// The OS-wide Secure Input state.
    #[must_use]
    pub fn secure_input_on(&self) -> bool {
        self.lock().scenario.secure_input_on
    }

    #[must_use]
    pub fn self_set(&self) -> Vec<u32> {
        self.lock().scenario.self_set.clone()
    }

    /// Keys the user holds physically: never released synthetically.
    #[must_use]
    pub fn physically_held_keys(&self) -> Vec<String> {
        self.lock().scenario.held_keys.clone()
    }

    /// Keys the engine pressed and has not released.
    #[must_use]
    pub fn engine_held_keys(&self) -> Vec<String> {
        self.lock().held.iter().cloned().collect()
    }

    #[must_use]
    pub fn full_access_preset(&self) -> bool {
        self.lock().scenario.full_access_preset
    }

    /// The session or hand that holds `window`'s reservation.
    #[must_use]
    pub fn reservation(&self, window: &str) -> Option<String> {
        self.lock().scenario.window_reservation.get(window).cloned()
    }

    #[must_use]
    pub fn code_identity(&self, pid: u32) -> Option<CodeIdentity> {
        self.lock().scenario.code_identity.get(&pid).cloned()
    }

    #[must_use]
    pub fn executable_path(&self, pid: u32) -> Option<String> {
        self.lock().scenario.executable_path.get(&pid).cloned()
    }

    #[must_use]
    pub fn hand(&self) -> Option<HandIdentity> {
        self.lock().scenario.hand.clone()
    }

    #[must_use]
    pub fn preview_subscribed(&self) -> bool {
        self.lock().scenario.preview_subscribed
    }
}
