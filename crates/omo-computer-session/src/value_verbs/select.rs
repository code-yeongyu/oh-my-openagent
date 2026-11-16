//! `ax.selectText` (row 24): a span or the one occurrence of a text inside the element's value,
//! in UTF-16 units. The refusal shapes are decided in ONE function until the plan rules them.

use omo_computer_core::backend::{Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{SelectTextParams, TextRange};
use omo_computer_core::text_range::{locate, NoRange, Utf16Range};

/// The range a request names inside `value`, or the refusal it answers.
pub(super) fn range_of(value: &str, range: &TextRange) -> Result<Utf16Range, crate::mutate::Refused> {
    use crate::mutate::Refused;
    match range {
        TextRange::Span { start, end } => {
            let (start, end) = (usize::try_from(*start).unwrap_or(usize::MAX), usize::try_from(*end).unwrap_or(usize::MAX));
            if end < start {
                let mut refused = Refused::from(Refusal::new(EngineCode::Internal, Reason::SpanInverted.wire()));
                refused.detail = Some(Box::new(serde_json::json!({ "field": "end", "message": "/end: expected end >= start" })));
                return Err(refused);
            }
            let length = value.encode_utf16().count();
            if end > length {
                let mut refused = Refused::from(Refusal::new(EngineCode::InvalidTarget, Reason::SpanOutOfRange.wire()));
                refused.detail = Some(Box::new(serde_json::json!({ "length": length })));
                return Err(refused);
            }
            Ok(Utf16Range { start, length: end - start })
        }
        TextRange::Text { text } => locate(value, text).map_err(|why| match why {
            NoRange::Ambiguous { occurrences } => {
                let mut refused = Refused::from(Refusal::new(EngineCode::InvalidTarget, Reason::Ambiguous.wire()));
                refused.detail = Some(Box::new(serde_json::json!({ "occurrences": occurrences })));
                refused
            }
            NoRange::Absent => Refused::from(Refusal::new(EngineCode::InvalidTarget, Reason::TextAbsent.wire())),
        }),
    }
}

impl crate::Session {
    /// `ax.selectText`.
    ///
    /// # Errors
    /// The ref's refusal, the range's refusal (nothing sent), or the funnel's.
    pub fn ax_select_text(&mut self, params: SelectTextParams) -> Result<omo_computer_core::results::ExecReply, crate::mutate::Refused> {
        let reference = self.qualified(&params.reference);
        let value = self
            .backend
            .ax()
            .and_then(|ax| ax.read_value(&omo_computer_core::backend::Ref(reference.clone())).ok().flatten())
            .unwrap_or_default();
        let range = range_of(&value, &params.range)?;
        let authority = omo_computer_core::requests::CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let window = self.ref_window(&reference)?;
        let call = omo_computer_safety::Call { verb: omo_computer_safety::VerbKind::Pointer, target: omo_computer_safety::TargetRef::read(Some(&window)), points: Vec::new(), chord: None, force: false };
        let write = super::Write::Select { reference, range };
        self.mutate(crate::mutate::Mutation::exec(omo_computer_core::methods::Method::AxSelectText, call, Vec::new(), Route::BackgroundWindow, &authority).with_write(write))
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::params::TextRange;

    use super::range_of;

    fn wire(value: &str, range: TextRange) -> (String, Option<String>, Option<serde_json::Value>) {
        let refused = range_of(value, &range).expect_err("refused");
        (refused.refusal.code.wire().to_owned(), refused.refusal.reason.map(str::to_owned), refused.detail.map(|d| *d))
    }

    #[test]
    fn select_text_refusals_follow_r64() {
        assert_eq!(wire("abc", TextRange::Text { text: "z".into() }), ("InvalidTarget".into(), Some("text_absent".into()), None));
        assert_eq!(wire("abab", TextRange::Text { text: "ab".into() }), ("InvalidTarget".into(), Some("ambiguous".into()), Some(serde_json::json!({"occurrences": 2}))));
        assert_eq!(wire("a\u{1F4CB}", TextRange::Span { start: 0, end: 4 }), ("InvalidTarget".into(), Some("span_out_of_range".into()), Some(serde_json::json!({"length": 3}))), "length in UTF-16 units");
        assert_eq!(wire("abc", TextRange::Span { start: 2, end: 1 }), ("Internal".into(), Some("span_inverted".into()), Some(serde_json::json!({"field": "end", "message": "/end: expected end >= start"}))));
        assert!(range_of("abc", &TextRange::Span { start: 1, end: 3 }).is_ok());
    }
}
