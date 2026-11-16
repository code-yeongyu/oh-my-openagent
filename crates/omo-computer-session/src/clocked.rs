//! The engine's session over the fake's clock (row 28): with the fake-clock seam installed the
//! guard's stop-path timing reads the same clock `$/test.advanceClock` moves.

use omo_computer_core::backend::Backend;
use omo_computer_core::paths::Roots;
use omo_computer_safety::guard::Clock;
use omo_computer_safety::Guard;

use crate::mutate::Funnel;
use crate::Session;

struct ReadClock<F>(F);

impl<F: Fn() -> u64 + Send> Clock for ReadClock<F> {
    fn now_ms(&self) -> u64 {
        (self.0)()
    }
}

impl Session {
    /// [`Session::for_roots`] with the guard reading the clock `now_ms` reads.
    #[must_use]
    pub fn for_roots_clocked(
        backend: Box<dyn Backend>,
        roots: &Roots,
        now_ms: impl Fn() -> u64 + Send + 'static,
    ) -> Self {
        let guard = Guard::for_roots(roots).with_clock(Box::new(ReadClock(now_ms)));
        Self::build(backend, guard, Funnel::for_roots(roots))
    }
}
