//! `observe`: the frame-ownership join, the secure-focus check, the core walk under the
//! observe deadline, the outline with its refs, and the generation those refs bind to.

use omo_computer_core::ax::{line, root_suffix, walk, Limits, LineStyle, RootRead, WindowKey};
use omo_computer_core::backend::{AxSnapshot, Refusal, SnapshotRequest, Target};
use omo_computer_core::error::{EngineCode, Reason};

use super::reader::{node_read, process_start};
use super::refs::RefEntry;
use super::AtspiBackend;
use crate::bus::{read_slice, Bus, NodeFacts, NodeId};
use crate::owner::{join, Join};
use crate::secure::is_secure;
use crate::types::{AxRefusal, Detail, NOT_ON_BUS_HINT};

/// The slice of the root and frame reads.
pub const ROOT_SLICE_MS: u64 = 250;

/// One observe: the snapshot, or an empty one when the focused element is secure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub snapshot: AxSnapshot,
    pub secure: bool,
}

/// The frame a window target resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Frame {
    pub node: NodeId,
    pub window: String,
    pub pid: u32,
    pub app: String,
}

impl<B: Bus> AtspiBackend<B> {
    /// The frame of `window` (a native window id, or an `atspi:` object id).
    pub(crate) fn frame_for(&mut self, window: &str) -> Result<Frame, AxRefusal> {
        let bus = self.bus.as_mut().ok_or_else(AxRefusal::no_bus)?;
        if let Some(node) = NodeId::parse(window) {
            let app = self.roster.apps.iter().find(|app| app.node.bus == node.bus);
            let (pid, name) = app.map_or((0, String::new()), |app| {
                (app.pid.unwrap_or(0), app.name.clone())
            });
            return Ok(Frame {
                node,
                window: window.to_owned(),
                pid,
                app: name,
            });
        }
        let natives = self.windows.windows();
        let target = natives.iter().find(|native| native.id == window).cloned();
        let target =
            target.ok_or_else(|| AxRefusal::plain(Refusal::bare(EngineCode::WindowNotFound)))?;
        let not_on_bus = || {
            AxRefusal::new(
                Refusal::new(EngineCode::AxUnsupported, Reason::NotOnBus),
                Detail::NotOnBus {
                    app: target.app.clone(),
                    hint: NOT_ON_BUS_HINT,
                },
            )
        };
        let pid = target.pid.ok_or_else(not_on_bus)?;
        self.roster.absorb(bus);
        if self.roster.app_of(pid).is_none() && self.roster.apps_dirty {
            self.roster.refresh(bus);
        }
        let app = self.roster.app_of(pid).cloned().ok_or_else(not_on_bus)?;
        let slice = read_slice(ROOT_SLICE_MS);
        let kids = bus
            .children(&app.node, slice)
            .map_err(|_| AxRefusal::plain(Refusal::bare(EngineCode::AxFailed)))?;
        let frames: Vec<(NodeId, NodeFacts)> = kids
            .into_iter()
            .filter_map(|kid| bus.read(&kid, slice).ok().map(|facts| (kid, facts)))
            .collect();
        let twins: Vec<_> = natives
            .into_iter()
            .filter(|native| native.pid == Some(pid) && native.title == target.title)
            .collect();
        match join(&target, &twins, &frames) {
            Join::Frame(node) => Ok(Frame {
                node,
                window: window.to_owned(),
                pid,
                app: app.name,
            }),
            Join::Unknown => Err(AxRefusal::plain(Refusal::bare(EngineCode::AxFailed))),
            Join::Ambiguous(candidates) => Err(AxRefusal::new(
                Refusal::new(EngineCode::InvalidTarget, Reason::Ambiguous),
                Detail::AmbiguousWindow { candidates },
            )),
        }
    }

    /// Whether the focused element of `frame`'s application is secure: read once, from the
    /// focus the events reported.
    fn focus_is_secure(&mut self, frame: &Frame) -> bool {
        let Some(bus) = self.bus.as_mut() else {
            return false;
        };
        self.roster.absorb(bus);
        let Some(focus) = self
            .roster
            .focus
            .clone()
            .filter(|focus| focus.bus == frame.node.bus)
        else {
            return false;
        };
        bus.read(&focus, read_slice(ROOT_SLICE_MS))
            .is_ok_and(|facts| facts.states.focused && is_secure(&facts))
    }

    /// Observes one window: refs `s<generation>:e<n>` over the walked elements.
    ///
    /// # Errors
    /// No bus, a target that is not a window, the join's refusal, or an unreadable frame.
    pub fn observe(&mut self, request: &SnapshotRequest) -> Result<Observation, AxRefusal> {
        let Target::Window(window) = &request.target else {
            return Err(AxRefusal::plain(Refusal::bare(EngineCode::InvalidTarget)));
        };
        let frame = self.frame_for(window)?;
        if self.focus_is_secure(&frame) {
            let generation = self.refs.mint(window, Vec::new());
            let snapshot = AxSnapshot {
                tree: String::new(),
                nodes_observed: 0,
                complete: false,
                generation,
            };
            return Ok(Observation {
                snapshot,
                secure: true,
            });
        }
        let bus = self.bus.as_mut().ok_or_else(AxRefusal::no_bus)?;
        let slice = read_slice(ROOT_SLICE_MS);
        let facts = bus
            .read(&frame.node, slice)
            .map_err(|_| AxRefusal::plain(Refusal::bare(EngineCode::AxFailed)))?;
        let handle = self.refs.handles.of(&frame.node);
        if facts.interfaces.action {
            self.refs.actionable.insert(frame.node.clone());
        }
        let root = node_read(bus, handle, &facts, slice, &frame.node);
        let limits = Limits::of(self);
        let walked = walk(self, root.clone(), &limits);
        let root_read = RootRead {
            window: WindowKey {
                id: frame.window.clone(),
                pid: frame.pid,
                process_start: process_start(frame.pid),
            },
            app: frame.app.clone(),
            focused: facts.states.active,
            node: root,
        };
        let generation = self.refs.next_generation();
        let style = LineStyle {
            actions: request.options.actions.unwrap_or(false),
            value: true,
        };
        let mut lines = Vec::with_capacity(walked.nodes.len());
        let mut entries = Vec::with_capacity(walked.nodes.len());
        for (index, node) in walked.nodes.iter().enumerate() {
            let token = format!("s{generation}:e{}", index + 1);
            let extra = if index == 0 {
                root_suffix(&root_read)
            } else {
                String::new()
            };
            let more = node
                .is_cut()
                .then(|| node.read.child_count.saturating_sub(node.children_read));
            let indent = "  ".repeat(usize::try_from(node.logical).unwrap_or(0));
            lines.push(format!(
                "{indent}{}",
                line(&node.read, &token, &extra, style, more)
            ));
            let id = node
                .read
                .handle
                .and_then(|h| self.refs.handles.node(h).cloned());
            entries.push(RefEntry::of(
                id,
                &node.read,
                node.parent,
                &self.refs.actionable,
            ));
        }
        let observed = u32::try_from(walked.nodes.len()).unwrap_or(u32::MAX);
        self.refs.insert(generation, window, entries);
        let snapshot = AxSnapshot {
            tree: lines.join("\n"),
            nodes_observed: observed,
            complete: walked.complete,
            generation,
        };
        Ok(Observation {
            snapshot,
            secure: false,
        })
    }
}
