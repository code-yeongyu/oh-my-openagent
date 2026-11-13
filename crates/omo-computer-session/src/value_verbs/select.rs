//! `ax.selectText` (row 24): a span or the one occurrence of a text inside the element's value,
//! in UTF-16 units. The refusal shapes are decided in ONE function until the plan rules them.

use omo_computer_core::backend::{Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{SelectTextParams, TextRange};
use omo_computer_core::text_range::{locate, NoRange, Utf16Range};

/// The range a request names inside `value`, or the refusal it answers.
pub(super) fn range_of(value: &str, range: &TextRange) -> Result<Utf16Range, Refusal> {
    match range {
        TextRange::Span { start, end } => {
            let (start, end) = (usize::try_from(*start).unwrap_or(usize::MAX), usize::try_from(*end).unwrap_or(usize::MAX));
            if end < start || end > value.encode_utf16().count() {
                return Err(Refusal::bare(EngineCode::AxFailed));
            }
            Ok(Utf16Range { start, length: end - start })
        }
        TextRange::Text { text } => locate(value, text).map_err(|why| match why {
            NoRange::Ambiguous { .. } => Refusal::new(EngineCode::InvalidTarget, Reason::Ambiguous.wire()),
            NoRange::Absent => Refusal::bare(EngineCode::AxFailed),
        }),
    }
}

impl crate::Session {
    /// `ax.selectText`.
    ///
    /// # Errors
    /// The ref's refusal, the range's refusal (nothing sent), or the funnel's.
    pub fn ax_select_text(&mut self, params: SelectTextParams) -> Result<omo_computer_core::results::ExecReply, crate::mutate::Refused> {
        use crate::mutate::Refused;
        let reference = self.qualified(&params.reference);
        let value = self
            .backend
            .ax()
            .and_then(|ax| ax.read_value(&omo_computer_core::backend::Ref(reference.clone())).ok().flatten())
            .unwrap_or_default();
        let range = range_of(&value, &params.range).map_err(Refused::from)?;
        let authority = omo_computer_core::requests::CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let window = self.ref_window(&reference)?;
        let call = omo_computer_safety::Call { verb: omo_computer_safety::VerbKind::Pointer, target: omo_computer_safety::TargetRef::read(Some(&window)), points: Vec::new(), chord: None, force: false };
        let write = super::Write::Select { reference, range };
        self.mutate(crate::mutate::Mutation::exec(omo_computer_core::methods::Method::AxSelectText, call, Vec::new(), Route::BackgroundWindow, &authority).with_write(write))
    }
}
