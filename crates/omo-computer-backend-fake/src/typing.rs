//! Interruptible typing on the fake: the text goes out scalar by scalar on the fake clock
//! (`typing_unit_ms` per scalar after the first, 0 when unscripted), the session's interrupt
//! is asked before every scalar after the first, and the delivered prefix is posted as ONE
//! Text input, so an uninterrupted text leaves exactly the sink line `post_input` leaves.

use omo_computer_core::backend::{Backend, InputEvent, Route, TaggedInput};
use omo_computer_core::intervention::{scalars, TextDelivery};

use crate::backend::FakeBackend;

impl FakeBackend {
    pub(crate) fn type_interruptible(
        &mut self,
        text: &str,
        route: Route,
        tag: u64,
        interrupt: &mut dyn FnMut(&dyn Backend) -> bool,
    ) -> TextDelivery {
        let of = scalars(text);
        let unit_ms = self.lock().scenario.typing_unit_ms.unwrap_or(0);
        let mut prefix = String::new();
        let mut interrupted = false;
        for (index, scalar) in text.chars().enumerate() {
            if index > 0 {
                self.clock.advance(unit_ms);
                if interrupt(self) {
                    interrupted = true;
                    break;
                }
            }
            prefix.push(scalar);
        }
        let sent = scalars(&prefix);
        let input = TaggedInput {
            event: InputEvent::Text(prefix),
            tag,
        };
        match self.post_input(&input, route) {
            Ok(_) => TextDelivery {
                sent,
                of,
                refusal: None,
                interrupted,
            },
            Err(refusal) => TextDelivery {
                sent: 0,
                of,
                refusal: Some(refusal),
                interrupted: false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use omo_computer_core::backend::{Backend, Route};

    use crate::{FakeBackend, FakeClock, FakeScenario, RecordingSink};

    fn fake(unit: &str) -> (FakeBackend, RecordingSink) {
        let sink = RecordingSink::default();
        let scenario = FakeScenario::from_json(&format!("{{{unit}}}")).expect("scenario");
        (
            FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone()),
            sink,
        )
    }

    #[test]
    fn an_uninterrupted_text_leaves_the_same_single_sink_line_as_post_input() {
        let (mut backend, sink) = fake("");
        let delivery = backend.post_text("hunter2", Route::BackgroundWindow, 9, &mut |_| false);
        assert_eq!((delivery.sent, delivery.of, delivery.interrupted), (7, 7, false));
        assert_eq!(
            sink.lines(),
            vec![r#"post_input route=backgroundwindow tag=9 text "hunter2""#.to_owned()]
        );
    }

    #[test]
    fn an_interrupt_after_the_third_scalar_posts_exactly_that_prefix() {
        let (mut backend, sink) = fake(r#""typing_unit_ms":10"#);
        let start = Backend::clock(&backend).expect("clock").now_ms();
        let asked = Cell::new(0);
        let delivery = backend.post_text(
            "abcdefghij",
            Route::BackgroundWindow,
            1,
            &mut |b: &dyn Backend| {
                asked.set(asked.get() + 1);
                b.clock().is_some_and(|clock| clock.now_ms() >= start + 30)
            },
        );
        assert_eq!((delivery.sent, delivery.of, delivery.interrupted), (3, 10, true));
        assert_eq!(asked.get(), 3);
        assert_eq!(
            sink.lines(),
            vec![r#"post_input route=backgroundwindow tag=1 text "abc""#.to_owned()]
        );
    }
}
