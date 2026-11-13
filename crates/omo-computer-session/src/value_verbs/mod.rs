//! Row 24's writes that are not input events (an element's value, its focus, a named action)
//! and the read-back that judges them (design row C8, acceptance 76): a value verb is
//! `confirmed` only when the value read back equals the value it asked for; a readable value
//! that differs is `observed` with an observation entry and `nextCall:"observe"`, and the frame
//! generation stays valid; a value that cannot be read back is `unverifiable`.

use omo_computer_core::backend::{Ref, Refusal, Semantic};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::report::{Disposition, Effect, Evidence};

use crate::intervention::{Outcome, Stop};
use crate::Session;

/// A write the funnel sends instead of input events.
#[derive(Debug, Clone, PartialEq)]
pub enum Write {
    /// `ax.setValue`: the value is read back after the write.
    SetValue { reference: String, value: String },
    /// `ax.focus`.
    Focus { reference: String },
    /// `ax.typeText` by AX insertion into a native text field.
    Insert { reference: String, text: String },
    /// `ax.selectText`: a range in UTF-16 units.
    Select { reference: String, range: omo_computer_core::text_range::Utf16Range },
    /// `ax.perform`: a named action; never `confirmed` from a read-back (an observer event or a
    /// read can only make it `observed`).
    Perform { reference: String, action: String },
    /// `window.setFrame`: the frame read back is judged by design row C8.
    SetFrame { window: String, asked: omo_computer_core::listing::Rect },
    /// `window.minimize` (`true`) or `window.restore` (`false`).
    Minimized { window: String, minimize: bool },
    /// `clipboard.write`.
    Clipboard { text: String },
    /// `paste`: write the text, press the paste chord, then put the prior clipboard back
    /// (never read when it was concealed).
    Paste { text: String, chord: String, restore: omo_computer_core::clipboard::Restore },
}

/// A value verb's read-back verdict, carried into the action report.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadBack {
    /// The report's note (a paste's `clipboardRestored:false, reason:"concealed"`).
    pub note: Option<String>,
    pub effect: Effect,
    pub disposition: Disposition,
    pub evidence: Vec<Evidence>,
    pub next_call: Option<String>,
}

impl ReadBack {
    /// The verdict on `intended` against what was read back (`None`: unreadable).
    #[must_use]
    pub fn judge(intended: &str, read: Option<String>, baseline: Option<String>) -> Self {
        match read {
            Some(value) if value == intended => Self {
                note: None,
                effect: Effect::Confirmed,
                disposition: Disposition::DELIVERED_VERIFIED,
                evidence: vec![Evidence::value_readback(Some(intended.to_owned()), Some(value), baseline)],
                next_call: None,
            },
            Some(value) => Self {
                note: None,
                effect: Effect::Observed,
                disposition: Disposition::DELIVERED_UNVERIFIED,
                evidence: vec![Evidence::value_readback(Some(intended.to_owned()), Some(value), baseline)],
                next_call: Some("observe".to_owned()),
            },
            None => Self {
                note: None,
                effect: Effect::Unverifiable,
                disposition: Disposition::DELIVERED_UNVERIFIED,
                evidence: Vec::new(),
                next_call: Some("observe".to_owned()),
            },
        }
    }
}

impl Session {
    /// Sends `write` through the backend's accessibility half and, for a value write, reads the
    /// value back. An unanswered write (`AxUnconfirmed`) went out: one unit sent, the stroke
    /// ended uncertain.
    pub(crate) fn send_write(&mut self, write: &Write) -> (Outcome, Option<ReadBack>) {
        match write {
            Write::SetFrame { window, asked } => return self.send_frame(window, *asked),
            Write::Clipboard { text } => return (outcome_of(self.backend.clipboard_write(text).map(|()| omo_computer_core::backend::Delivered { count: 1, of: 1 })), None),
            Write::Paste { text, chord, restore } => return self.send_paste(text, chord, restore),
            Write::Minimized { window, minimize } => {
                let sent = self.backend.set_minimized(window, *minimize).map(|()| omo_computer_core::backend::Delivered { count: 1, of: 1 });
                return (outcome_of(sent), None);
            }
            _ => {}
        }
        let Some(ax) = self.backend.ax() else {
            return (outcome_of(Err(Refusal::new(EngineCode::AxUnsupported, Reason::PerformUnsupported.wire()))), None);
        };
        let sent = match write {
            Write::SetValue { reference, value } => {
                let reference = Ref(reference.clone());
                let baseline = ax.read_value(&reference).ok().flatten();
                match ax.set_value(&reference, value) {
                    Ok(_) => {
                        let read = ax.read_value(&reference).ok().flatten();
                        return (Outcome { count: 1, of: 1, stop: None }, Some(ReadBack::judge(value, read, baseline)));
                    }
                    Err(refusal) => Err(refusal),
                }
            }
            Write::Focus { reference } => ax.focus(&Ref(reference.clone())),
            Write::Insert { reference, text } => ax.insert_text(&Ref(reference.clone()), text),
            Write::Select { reference, range } => ax.select_range(&Ref(reference.clone()), *range),
            Write::Perform { reference, action } => ax.perform(&Ref(reference.clone()), &Semantic(action.clone())),
            Write::SetFrame { .. } | Write::Minimized { .. } | Write::Clipboard { .. } | Write::Paste { .. } => {
                unreachable!("non-AX writes return above")
            }
        };
        (outcome_of(sent), None)
    }
}

impl Session {
    /// A frame write and its read-back: `confirmed` with a `frame_readback` receipt when every
    /// edge is within 1 px (R59), `partial` with the kept axes otherwise.
    fn send_frame(&mut self, window: &str, asked: omo_computer_core::listing::Rect) -> (Outcome, Option<ReadBack>) {
        use omo_computer_core::window_frame::{judge, FrameOutcome};
        let baseline = self
            .backend
            .windows(&omo_computer_core::backend::WindowFilter::default())
            .ok()
            .and_then(|list| list.windows.into_iter().find(|w| w.id == window))
            .map(|w| w.bounds);
        let applied = match self.backend.set_frame(window, asked) {
            Ok(applied) => applied,
            Err(refusal) => return (outcome_of(Err(refusal)), None),
        };
        let evidence = vec![Evidence::frame_readback(asked, applied.frame, baseline)];
        let read_back = match judge(asked, applied.frame) {
            FrameOutcome::Confirmed => ReadBack { note: None, effect: Effect::Confirmed, disposition: Disposition::DELIVERED_VERIFIED, evidence, next_call: None },
            FrameOutcome::Partial { kept } => ReadBack {
                note: Some(format!("kept: {}", kept.iter().map(|axis| axis.wire()).collect::<Vec<_>>().join(","))),
                effect: Effect::Partial,
                disposition: Disposition::DELIVERED_UNVERIFIED,
                evidence,
                next_call: None,
            },
        };
        (Outcome { count: 1, of: 1, stop: None }, Some(read_back))
    }
}

impl Session {
    /// The paste: the clipboard holds the text only for the chord, then the prior clipboard is
    /// put back; a concealed prior clipboard was never read and is not restored.
    fn send_paste(&mut self, text: &str, chord: &str, restore: &omo_computer_core::clipboard::Restore) -> (Outcome, Option<ReadBack>) {
        use omo_computer_core::clipboard::Restore;
        if let Err(refusal) = self.backend.clipboard_write(text) {
            return (outcome_of(Err(refusal)), None);
        }
        let keys = omo_computer_core::keys::chord_keys(chord).unwrap_or_default();
        let mut events: Vec<_> = keys.iter().map(|key| crate::mutate::key_event(key, true)).collect();
        events.extend(keys.iter().rev().map(|key| crate::mutate::key_event(key, false)));
        let mut sent = 0;
        for event in events {
            if crate::intervention::post_one(self.backend.as_mut(), event, 0, omo_computer_core::backend::Route::ForegroundHid).is_ok() {
                sent += 1;
            }
        }
        let note = match restore {
            Restore::Put(prior) => {
                let _ = self.backend.clipboard_write(prior.as_deref().unwrap_or_default());
                None
            }
            Restore::SkippedConcealed => Some("clipboardRestored:false, reason:\"concealed\"".to_owned()),
        };
        let read_back = ReadBack { note, effect: Effect::Unverifiable, disposition: Disposition::DELIVERED_UNVERIFIED, evidence: Vec::new(), next_call: None };
        (Outcome { count: sent, of: u32::try_from(keys.len() * 2).unwrap_or(u32::MAX), stop: None }, Some(read_back))
    }
}

fn outcome_of(sent: Result<omo_computer_core::backend::Delivered, Refusal>) -> Outcome {
    match sent {
        Ok(delivered) => Outcome { count: delivered.count, of: delivered.of, stop: None },
        Err(refusal) if refusal.code == EngineCode::AxUnconfirmed => {
            Outcome { count: 1, of: 1, stop: Some(Stop::Refused(refusal)) }
        }
        Err(refusal) => Outcome { count: 0, of: 1, stop: Some(Stop::Refused(refusal)) },
    }
}

mod dispatch;
mod keys;
mod select;
mod verbs;

#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod keys_tests;
#[cfg(test)]
mod window_frame_tests;
#[cfg(test)]
mod type_text_tests;
#[cfg(test)]
mod tests;
