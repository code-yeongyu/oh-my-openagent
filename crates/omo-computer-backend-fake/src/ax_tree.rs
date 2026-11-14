//! Walking a scripted accessibility tree: the flat node order refs index into, the text a
//! snapshot carries, and the node a ref names.

use omo_computer_core::listing::ElementInfo;
use omo_computer_core::untrusted::UntrustedText;

use crate::scenario::FakeAxNode;
use crate::sink::quoted;

/// Nodes the fake reads per millisecond of its observation deadline.
pub const NODES_PER_MS: u64 = 100;

/// The role of the padding leaves a dense-tree scenario adds.
pub const PAD_ROLE: &str = "statictext";

/// Depth-first nodes with their depth: ref `e<n>` is entry `n - 1`.
#[must_use]
pub fn flatten(root: &FakeAxNode) -> Vec<(usize, &FakeAxNode)> {
    let mut out = Vec::new();
    let mut stack = vec![(0_usize, root)];
    while let Some((depth, node)) = stack.pop() {
        out.push((depth, node));
        stack.extend(node.children.iter().rev().map(|child| (depth + 1, child)));
    }
    out
}

fn line(index: usize, depth: usize, node: &FakeAxNode) -> String {
    let mut text = format!("{}e{} {}", "  ".repeat(depth), index + 1, node.role);
    if let Some(title) = &node.title {
        text.push(' ');
        text.push_str(&quoted(title));
    }
    if let Some(value) = &node.value {
        text.push_str(" value=");
        text.push_str(&quoted(value));
    }
    if node.focused {
        text.push_str(" focused");
    }
    text
}

/// The first `observed` lines of a tree padded to `total` nodes.
#[must_use]
pub fn render(nodes: &[(usize, &FakeAxNode)], total: usize, observed: usize) -> String {
    let real = nodes
        .iter()
        .enumerate()
        .take(observed)
        .map(|(index, (depth, node))| line(index, *depth, node));
    let padding =
        (nodes.len()..total.min(observed)).map(|index| format!("  e{} {PAD_ROLE}", index + 1));
    real.chain(padding).collect::<Vec<_>>().join("\n")
}

/// A ref token `s<generation>:e<n>` split into its parts.
#[must_use]
pub fn parse_ref(token: &str) -> Option<(u64, usize)> {
    let (snapshot, element) = token.split_once(':')?;
    let generation = snapshot.strip_prefix('s')?.parse().ok()?;
    let index = element.strip_prefix('e')?.parse::<usize>().ok()?;
    index.checked_sub(1).map(|index| (generation, index))
}

#[must_use]
pub fn element_info(token: &str, node: &FakeAxNode, window: &str, generation: u64) -> ElementInfo {
    ElementInfo {
        reference: token.to_owned(),
        role: node.role.clone(),
        label: node.title.clone().or_else(|| node.description.clone()),
        native_role: node.native_role.clone(),
        title: node.title.clone(),
        description: node.description.clone(),
        value: node.value.clone(),
        enabled: Some(node.enabled.unwrap_or(true)),
        focused: Some(node.focused),
        child_count: Some(u32::try_from(node.children.len()).unwrap_or(u32::MAX)),
        bounds: node.bounds,
        actions: Some(node.actions.clone()),
        window: window.to_owned(),
        generation,
        observation: UntrustedText,
    }
}
