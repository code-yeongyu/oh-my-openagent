//! The frame and trace wiring of the session verbs: the trace a session opens and closes, the
//! frame a click maps through, and the traced funnel call.

use omo_computer_core::frame::FrameRefusal;
use omo_computer_core::params::Point;
use omo_computer_core::requests::{At, TraceMode};
use omo_computer_core::results::ExecReply;
use serde_json::Value;

use crate::frames::admit::frame_key;
use crate::mutate::{Mutation, Refused};
use crate::trace::Trace;
use crate::Session;

/// The frame check a click carries into the funnel: the frame refusal, or the
/// `(target, frame id)` a `consume:true` call consumes.
pub(crate) type FrameCheck = (Option<FrameRefusal>, Option<(String, String)>);

impl Session {
    /// Opens the session's trace in the artifact store's directory.
    pub(crate) fn open_trace(&mut self, mode: Option<TraceMode>, session_id: &str) {
        let trace_dir = self.artifacts().map(|store| store.dir().to_owned());
        self.trace = Trace::open(
            mode.unwrap_or(TraceMode::Off),
            trace_dir,
            session_id,
            crate::audit::now_ms(),
        );
    }

    /// Finalises the trace manifest; a failure warns and never fails the close.
    pub(crate) fn close_trace(&mut self) {
        if let Err(error) = self.trace.close(crate::audit::now_ms()) {
            eprintln!("omo-computer-engine: warn trace manifest not finalised: {error}");
        }
    }

    /// The frame key of a click on `target`, the point it sends, and its frame check: the
    /// point the admitted frame maps `at` to, else `at` itself with the refusal.
    pub(crate) fn frame_for(
        &mut self,
        target: Option<&str>,
        frame_id: Option<&str>,
        at: At,
        consume: bool,
    ) -> (String, Point, FrameCheck) {
        let key = frame_key(target);
        let (point, check) = match self.admit_frame(&key, frame_id, at.x, at.y) {
            Ok(admitted) => (
                admitted.point,
                (None, consume.then(|| (key.clone(), admitted.frame_id))),
            ),
            Err(refusal) => (Point { x: at.x, y: at.y }, (Some(refusal), None)),
        };
        (key, point, check)
    }

    /// Runs `mutation` through the funnel and records the call in the trace.
    pub(crate) fn traced(
        &mut self,
        dispatched: Value,
        key: &str,
        mutation: Mutation<'_>,
    ) -> Result<ExecReply, Refused> {
        let method = mutation.method;
        let result = self.mutate(mutation);
        self.trace_turn(method, dispatched, key, &result);
        result
    }
}
