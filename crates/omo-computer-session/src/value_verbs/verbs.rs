//! Row 24's AX exec verbs on the funnel: the element's window is the call's target (gated like
//! any exec on it), and the write is sent instead of input events.

use omo_computer_core::backend::{Ref, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::methods::Method;
use omo_computer_core::params::{AxPerformParams, AxRefParams, AxSetValueParams};
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::ExecReply;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use super::Write;
use crate::mutate::{Mutation, Refused};
use crate::Session;

impl Session {
    /// `ax.snapshot` (read tier): the window's accessibility outline, with element refs.
    ///
    /// # Errors
    /// `AxUnsupported` with no accessibility half, or the backend's refusal.
    pub fn ax_snapshot(&mut self, params: omo_computer_core::params::AxTargetParams) -> Result<omo_computer_core::results::AxSnapshotText, Refused> {
        let ax = self
            .backend
            .ax()
            .ok_or_else(|| Refused::from(Refusal::new(EngineCode::AxUnsupported, Reason::SnapshotUnsupported.wire())))?;
        let request = omo_computer_core::backend::SnapshotRequest {
            target: omo_computer_core::backend::Target::Window(params.target),
            options: omo_computer_core::params::ObserveOptions::default(),
        };
        let snapshot = ax.snapshot(&request).map_err(Refused::from)?;
        self.ax_generation = Some(snapshot.generation);
        Ok(omo_computer_core::results::AxSnapshotText { text: snapshot.tree, node_count: snapshot.nodes_observed, truncated: !snapshot.complete })
    }

    /// A v1 ref (`e2`) names an element of the latest snapshot; a qualified ref is kept as is.
    pub(crate) fn qualified(&self, reference: &str) -> String {
        match self.ax_generation {
            Some(generation) if !reference.contains(':') => format!("s{generation}:{reference}"),
            _ => reference.to_owned(),
        }
    }

    /// The window an element ref lives in.
    pub(crate) fn ref_window(&mut self, reference: &str) -> Result<String, Refused> {
        let ax = self
            .backend
            .ax()
            .ok_or_else(|| Refused::from(Refusal::new(EngineCode::AxUnsupported, Reason::ResolveUnsupported.wire())))?;
        ax.resolve(&Ref(reference.to_owned())).map(|resolved| resolved.element.window).map_err(Refused::from)
    }

    fn ax_write(&mut self, method: Method, reference: &str, authority: &CallAuthority, write: Write) -> Result<ExecReply, Refused> {
        let window = self.ref_window(reference)?;
        let call = Call { verb: VerbKind::Pointer, target: TargetRef::read(Some(&window)), points: Vec::new(), chord: None, force: false };
        self.mutate(Mutation::exec(method, call, Vec::new(), Route::BackgroundWindow, authority).with_write(write))
    }

    /// `ax.setValue`: `confirmed` only when the value read back equals the value written.
    ///
    /// # Errors
    /// The ref's refusal or the funnel's.
    pub fn ax_set_value(&mut self, params: AxSetValueParams) -> Result<ExecReply, Refused> {
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let reference = self.qualified(&params.reference);
        let write = Write::SetValue { reference: reference.clone(), value: params.value };
        self.ax_write(Method::AxSetValue, &reference, &authority, write)
    }

    /// `ax.focus`.
    ///
    /// # Errors
    /// The ref's refusal or the funnel's.
    pub fn ax_focus(&mut self, params: AxRefParams) -> Result<ExecReply, Refused> {
        let reference = self.qualified(&params.reference);
        let write = Write::Focus { reference: reference.clone() };
        self.ax_write(Method::AxFocus, &reference, &CallAuthority::default(), write)
    }

    /// `ax.perform`: the named action; never `confirmed` from a read-back.
    ///
    /// # Errors
    /// The ref's refusal or the funnel's.
    pub fn ax_perform(&mut self, params: AxPerformParams) -> Result<ExecReply, Refused> {
        let reference = self.qualified(&params.reference);
        let write = Write::Perform { reference: reference.clone(), action: params.action };
        self.ax_write(Method::AxPerform, &reference, &CallAuthority::default(), write)
    }

    /// `ax.typeText`: a native text field takes the text by insertion (`inserted`); any other
    /// element is focused and takes the text as keys (`keys`).
    ///
    /// # Errors
    /// The ref's refusal, `AxUnconfirmed` for an insertion the app did not answer, or the
    /// funnel's refusal.
    pub fn ax_type_text(&mut self, params: omo_computer_core::params::AxTypeTextParams) -> Result<omo_computer_core::results::AxTypeTextReply, Refused> {
        use omo_computer_core::results::{AxTypeTextReply, TypeTextMethod};
        let reference = self.qualified(&params.reference);
        let takes_text = self
            .backend
            .ax()
            .and_then(|ax| ax.resolve(&Ref(reference.clone())).ok())
            .is_some_and(|resolved| resolved.element.value.is_some());
        if takes_text {
            let write = Write::Insert { reference: reference.clone(), text: params.text };
            self.ax_write(Method::AxTypeText, &reference, &CallAuthority::default(), write)?;
            return Ok(AxTypeTextReply { method: TypeTextMethod::Inserted });
        }
        self.ax_write(Method::AxFocus, &reference, &CallAuthority::default(), Write::Focus { reference: reference.clone() })?;
        let window = self.ref_window(&reference)?;
        let call = Call { verb: VerbKind::Keyboard, target: TargetRef::read(Some(&window)), points: Vec::new(), chord: None, force: false };
        self.mutate(Mutation::typed(Method::AxTypeText, call, Route::BackgroundWindow, params.text))?;
        Ok(AxTypeTextReply { method: TypeTextMethod::Keys })
    }
}
