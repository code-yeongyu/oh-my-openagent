//! Row 23's registration on row 21's lease hook (R45, R48 item 2): every lease end - stop,
//! release, revoke, `display.release`, session close - releases every hold. The pair impl lets
//! row 22's display-awake hook and this one share the one hook slot; it calls BOTH, in order,
//! and never short-circuits.

use omo_computer_core::backend::Backend;

use super::SharedLedger;
use crate::grant::{LeaseHook, NoLeaseHook};
use crate::presence::LeaseEnd;

pub(crate) struct HoldsLeaseHook(pub(crate) SharedLedger);

impl LeaseHook for HoldsLeaseHook {
    fn lease_ended(&mut self, backend: &mut dyn Backend, _why: LeaseEnd) {
        self.0.release_all(backend);
    }
}

impl<A: LeaseHook, B: LeaseHook> LeaseHook for (A, B) {
    fn lease_ended(&mut self, backend: &mut dyn Backend, why: LeaseEnd) {
        self.0.lease_ended(backend, why);
        self.1.lease_ended(backend, why);
    }

    fn display_resumed(&mut self, backend: &mut dyn Backend) {
        self.0.display_resumed(backend);
        self.1.display_resumed(backend);
    }
}

impl LeaseHook for Box<dyn LeaseHook> {
    fn lease_ended(&mut self, backend: &mut dyn Backend, why: LeaseEnd) {
        self.as_mut().lease_ended(backend, why);
    }

    fn display_resumed(&mut self, backend: &mut dyn Backend) {
        self.as_mut().display_resumed(backend);
    }
}

/// Puts row 23's release after the hook the session already has (row 22's display-awake
/// rule), so both run on every lease end; `Session::with_guard` builds every session through it.
pub(crate) fn with_holds(mut session: crate::Session) -> crate::Session {
    let earlier = std::mem::replace(&mut session.funnel.control.lease_hook, Box::new(NoLeaseHook));
    let holds = HoldsLeaseHook(session.funnel.control.holds.clone());
    session.set_lease_hook(Box::new((earlier, holds)));
    session
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use omo_computer_backend_fake::FakeBackend;

    use super::*;

    struct Count(&'static str, Arc<Mutex<Vec<String>>>);

    impl LeaseHook for Count {
        fn lease_ended(&mut self, _backend: &mut dyn Backend, why: LeaseEnd) {
            self.1.lock().expect("log").push(format!("{} {why:?}", self.0));
        }

        fn display_resumed(&mut self, _backend: &mut dyn Backend) {
            self.1.lock().expect("log").push(format!("{} resumed", self.0));
        }
    }

    #[test]
    fn the_pair_runs_both_hooks_in_order_on_every_lease_end() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut pair: (Box<dyn LeaseHook>, Count) = (Box::new(Count("a", log.clone())), Count("b", log.clone()));
        let mut backend = FakeBackend::from_json("{}").expect("empty scenario");
        let ends = [LeaseEnd::Release, LeaseEnd::DisplayRelease, LeaseEnd::Stop];
        for why in ends {
            pair.lease_ended(&mut backend, why);
        }
        pair.display_resumed(&mut backend);
        let expected: Vec<String> = ends
            .iter()
            .flat_map(|why| [format!("a {why:?}"), format!("b {why:?}")])
            .chain(["a resumed".to_owned(), "b resumed".to_owned()])
            .collect();
        assert_eq!(*log.lock().expect("log"), expected);
    }
}
