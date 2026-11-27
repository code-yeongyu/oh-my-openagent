use omo_computer_core::methods::Method;

use crate::Session;
use crate::mutate::Mutation;

use super::look::Action;
use super::reports::{CursorReports, Publisher};

impl Session {
    /// The local renderer's feed for this open generation, absent before open or after close.
    #[must_use]
    pub fn cursor_reports(&self) -> Option<CursorReports> {
        self.opened.as_ref()?.cursor.as_ref().map(Publisher::reader)
    }

    pub(crate) fn register_cursor(&mut self) {
        if let Some(opened) = &mut self.opened {
            match self.cursor_palette.register() {
                Ok(colour) => opened.cursor = Some(Publisher::new(colour)),
                Err(error) => {
                    eprintln!("omo-computer-engine: warn cursor feed unavailable: {error}")
                }
            }
        }
    }

    pub(crate) fn offer_cursor(&mut self, mutation: &Mutation<'_>) {
        let Some(cursor) = self
            .opened
            .as_mut()
            .and_then(|opened| opened.cursor.as_mut())
        else {
            return;
        };
        // These are the exec routes currently wired to this funnel. Use the admitted
        // input point, never the request coordinates or the user's pointer.
        match mutation.method {
            Method::Click => cursor.offer(Action::Click, mutation.call.points.first().copied()),
            Method::TypeText => cursor.offer(Action::Text, None),
            _ => {}
        }
    }
}
