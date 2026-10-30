//! Flattened scripted accessibility trees addressed by numeric node id.

use std::collections::BTreeMap;

use senpi_desktop_core::ax::{AxBounds, AxHandle, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::text_range::{replace_utf16_selection, utf16_byte_range, Utf16Range};

use crate::scenario::FakeAxNode;

struct AxEntry {
    props: AxProps,
    parent: Option<u64>,
    children: Vec<u64>,
    /// The selected range of a text value, in UTF-16 units; `None` is a caret
    /// at the end of the value.
    selection: Option<Utf16Range>,
}

#[derive(Default)]
pub(crate) struct AxTree {
    nodes: BTreeMap<u64, AxEntry>,
    roots: BTreeMap<String, u64>,
    next_id: u64,
}

impl AxTree {
    pub(crate) fn build(trees: &BTreeMap<String, FakeAxNode>) -> Self {
        let mut tree = Self {
            next_id: 1,
            ..Self::default()
        };
        for (window_id, root) in trees {
            let id = tree.insert(root, None);
            tree.roots.insert(window_id.clone(), id);
        }
        tree
    }

    fn insert(&mut self, node: &FakeAxNode, parent: Option<u64>) -> u64 {
        let id = self.next_id;
        self.next_id = id.saturating_add(1);
        let children = node
            .children
            .iter()
            .map(|child| self.insert(child, Some(id)))
            .collect();
        let props = AxProps {
            role: node.role.clone(),
            native_role: node.native_role.clone().unwrap_or_else(|| node.role.clone()),
            title: node.title.clone(),
            value: node.value.clone(),
            description: node.description.clone(),
            enabled: node.enabled,
            focused: node.focused,
            bounds: node.bounds.map(|b| AxBounds {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
            }),
            actions: node.actions.clone(),
            child_count: u32::try_from(node.children.len()).unwrap_or(u32::MAX),
        };
        self.nodes.insert(
            id,
            AxEntry {
                props,
                parent,
                children,
                selection: None,
            },
        );
        id
    }

    pub(crate) fn root(&self, window_id: &str) -> CoreResult<u64> {
        self.roots.get(window_id).copied().ok_or_else(|| {
            DesktopError::ax_failed(format!("no accessibility tree scripted for window {window_id}"))
        })
    }

    fn entry(&self, id: u64) -> CoreResult<&AxEntry> {
        self.nodes
            .get(&id)
            .ok_or_else(|| DesktopError::ax_failed(format!("unknown fake AX node {id}")))
    }

    pub(crate) fn props(&self, id: u64) -> CoreResult<AxProps> {
        self.entry(id).map(|entry| entry.props.clone())
    }

    pub(crate) fn children(&self, id: u64) -> CoreResult<Vec<u64>> {
        self.entry(id).map(|entry| entry.children.clone())
    }

    pub(crate) fn parent(&self, id: u64) -> CoreResult<Option<u64>> {
        self.entry(id).map(|entry| entry.parent)
    }

    /// Fails with `AxFailed` unless the node advertises `action`.
    pub(crate) fn check_action(&self, id: u64, action: &str) -> CoreResult<()> {
        if self.entry(id)?.props.actions.iter().any(|known| known == action) {
            Ok(())
        } else {
            Err(DesktopError::ax_failed(format!(
                "fake AX node {id} does not support '{action}'"
            )))
        }
    }

    pub(crate) fn set_value(&mut self, id: u64, value: &str) -> CoreResult<()> {
        let entry = self
            .nodes
            .get_mut(&id)
            .ok_or_else(|| DesktopError::ax_failed(format!("unknown fake AX node {id}")))?;
        entry.props.value = Some(value.to_string());
        // A replaced value puts the caret after it, as a field does: the next
        // insertion appends instead of landing at the old caret.
        entry.selection = None;
        Ok(())
    }

    /// Inserts `text` at the node's selection (a caret at the end of the
    /// value unless one was selected), replacing the selected text; the caret
    /// then sits after the inserted text.
    pub(crate) fn insert_text(&mut self, id: u64, text: &str) -> CoreResult<()> {
        let entry = self
            .nodes
            .get_mut(&id)
            .ok_or_else(|| DesktopError::ax_failed(format!("unknown fake AX node {id}")))?;
        let value = entry.props.value.get_or_insert_with(String::new);
        let selection = entry.selection.unwrap_or(Utf16Range {
            start: value.encode_utf16().count(),
            length: 0,
        });
        *value = replace_utf16_selection(value, selection, text)?;
        entry.selection = Some(Utf16Range {
            start: selection.start + text.encode_utf16().count(),
            length: 0,
        });
        Ok(())
    }

    /// Selects the node's whole value, as `cmd+a` does in a text field.
    pub(crate) fn select_all(&mut self, id: u64) -> CoreResult<()> {
        let length = self.value(id)?.map_or(0, |value| value.encode_utf16().count());
        self.select(id, Utf16Range { start: 0, length })
    }

    /// Selects `range` of the node's value; the range must lie inside it.
    pub(crate) fn select(&mut self, id: u64, range: Utf16Range) -> CoreResult<()> {
        let entry = self
            .nodes
            .get_mut(&id)
            .ok_or_else(|| DesktopError::ax_failed(format!("unknown fake AX node {id}")))?;
        let value = entry.props.value.as_deref().unwrap_or_default();
        if utf16_byte_range(value, range).is_none() {
            return Err(DesktopError::ax_failed(format!(
                "selection {}+{} is outside fake AX node {id}'s value",
                range.start, range.length
            )));
        }
        entry.selection = Some(range);
        Ok(())
    }

    /// The node's value, for locating text to select.
    pub(crate) fn value(&self, id: u64) -> CoreResult<Option<String>> {
        self.entry(id).map(|entry| entry.props.value.clone())
    }

    /// Moves AX focus to `id`, clearing it everywhere else.
    pub(crate) fn focus(&mut self, id: u64) -> CoreResult<()> {
        self.entry(id)?;
        for (node, entry) in &mut self.nodes {
            entry.props.focused = *node == id;
        }
        Ok(())
    }

    pub(crate) fn focused(&self) -> Option<u64> {
        self.nodes
            .iter()
            .find(|(_, entry)| entry.props.focused)
            .map(|(id, _)| *id)
    }

    /// Deepest node whose bounds contain the global logical point.
    pub(crate) fn element_at(&self, x: f64, y: f64) -> Option<u64> {
        self.roots.values().find_map(|root| self.hit(*root, x, y))
    }

    fn hit(&self, id: u64, x: f64, y: f64) -> Option<u64> {
        let entry = self.nodes.get(&id)?;
        entry
            .children
            .iter()
            .find_map(|child| self.hit(*child, x, y))
            .or_else(|| {
                entry
                    .props
                    .bounds
                    .filter(|b| x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height)
                    .map(|_| id)
            })
    }

    /// The window whose scripted tree holds `id`.
    pub(crate) fn window_of(&self, id: u64) -> CoreResult<Option<String>> {
        let mut root = id;
        while let Some(parent) = self.entry(root)?.parent {
            root = parent;
        }
        Ok(self
            .roots
            .iter()
            .find(|(_, node)| **node == root)
            .map(|(window, _)| window.clone()))
    }

    pub(crate) fn attributes(&self, id: u64) -> CoreResult<Vec<(String, String)>> {
        let props = &self.entry(id)?.props;
        let optional = [
            ("title", &props.title),
            ("value", &props.value),
            ("description", &props.description),
        ];
        Ok([
            ("role", Some(&props.role)),
            ("nativeRole", Some(&props.native_role)),
        ]
        .into_iter()
        .chain(optional.into_iter().map(|(name, value)| (name, value.as_ref())))
        .filter_map(|(name, value)| value.map(|value| (name.to_string(), value.clone())))
        .collect())
    }
}

/// The node id inside a handle this fake produced.
pub(crate) fn node_id(handle: &AxHandle) -> CoreResult<u64> {
    match handle {
        AxHandle::Id(id) => Ok(*id),
        AxHandle::Native(_) => Err(DesktopError::ax_failed(
            "fake backend received a native AX handle",
        )),
    }
}
