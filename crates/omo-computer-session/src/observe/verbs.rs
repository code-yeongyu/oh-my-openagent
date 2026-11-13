//! The session's read verbs over the observation model: `observe`, `ax.drill`, `ax.node` and
//! `ax.children`. Each resolves refs through the registry before it reads anything by ref.

use omo_computer_core::ax::NodeRead;
use omo_computer_core::listing::Rect;
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::Observation;
use omo_computer_core::params::{AxRefParams, DrillParams, ObserveParams, ReportMode};
use omo_computer_core::results::AxNode;

use super::{drill, observe, Request};
use crate::refs::Unresolved;
use crate::session::{Session, NOT_OPEN};

/// A backend without accessibility reads.
const NO_READER: Refusal = Refusal::new(EngineCode::AxUnsupported, "snapshot_unsupported");

/// A null-mode `observe` is the v1 capture, which this session does not serve yet.
const NO_CAPTURE: Refusal = Refusal::new(EngineCode::CaptureUnavailable, "capture_unsupported");

fn ax_node(token: String, read: &NodeRead) -> AxNode {
    let bounds = read.bounds.unwrap_or(Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
    AxNode {
        reference: token,
        role: read.role.clone(),
        native_role: read.native_role.clone(),
        title: read.title.clone(),
        value: if read.secure { None } else { read.value.clone() },
        description: read.description.clone(),
        enabled: read.enabled.unwrap_or(true),
        focused: read.focused.unwrap_or(false),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        actions: read.actions.clone(),
        child_count: read.child_count,
    }
}

impl Session {
    fn object_mode(&self) -> Result<bool, Refusal> {
        let opened = self.opened.as_ref().ok_or(NOT_OPEN)?;
        Ok(matches!(opened.report_mode, ReportMode::Object))
    }

    /// # Errors
    /// [`NOT_OPEN`], a null-mode session, no reader, or the reader's refusal of the window.
    pub fn observe(&mut self, params: ObserveParams) -> Result<Observation, Unresolved> {
        if !self.object_mode()? {
            return Err(NO_CAPTURE.into());
        }
        let request = Request::read(params);
        let private = self.private_mode(&request.target);
        let mut withholding = crate::redaction::Withholding::new(self.backend.ax_reader().ok_or(NO_READER)?);
        let reader = &mut withholding;
        let mut observation = observe(&mut self.refs, reader, &request)?;
        if private {
            crate::redaction::withhold_observation(&mut observation);
        }
        Ok(observation)
    }

    /// # Errors
    /// [`NOT_OPEN`], no reader, or the ref's resolution refusal.
    pub fn drill(&mut self, params: DrillParams) -> Result<Observation, Unresolved> {
        let object_mode = self.object_mode()?;
        let mut withholding = crate::redaction::Withholding::new(self.backend.ax_reader().ok_or(NO_READER)?);
        let reader = &mut withholding;
        drill(&mut self.refs, reader, &params.reference, params.depth, object_mode)
    }

    /// The element a ref names, re-identified and read live.
    ///
    /// # Errors
    /// [`NOT_OPEN`], no reader, or the ref's resolution refusal.
    pub fn ax_node(&mut self, params: AxRefParams) -> Result<AxNode, Unresolved> {
        let object_mode = self.object_mode()?;
        let mut withholding = crate::redaction::Withholding::new(self.backend.ax_reader().ok_or(NO_READER)?);
        let reader = &mut withholding;
        let resolved = self.refs.resolve(&params.reference, object_mode, reader)?;
        let generation = self.refs.generation(&resolved.window, resolved.generation).ok_or(Refusal::bare(EngineCode::StaleRef))?;
        Ok(ax_node(generation.token(resolved.index), &resolved.live))
    }

    /// The children the ref's generation observed under it.
    ///
    /// # Errors
    /// [`NOT_OPEN`], no reader, or the ref's resolution refusal.
    pub fn ax_children(&mut self, params: AxRefParams) -> Result<Vec<AxNode>, Unresolved> {
        let object_mode = self.object_mode()?;
        let mut withholding = crate::redaction::Withholding::new(self.backend.ax_reader().ok_or(NO_READER)?);
        let reader = &mut withholding;
        let resolved = self.refs.resolve(&params.reference, object_mode, reader)?;
        let generation = self.refs.generation(&resolved.window, resolved.generation).ok_or(Refusal::bare(EngineCode::StaleRef))?;
        Ok(generation
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| entry.parent == Some(resolved.index))
            .map(|(index, entry)| ax_node(generation.token(index), &entry.read))
            .collect())
    }
}
