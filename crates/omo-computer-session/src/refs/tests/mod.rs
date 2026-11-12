//! The registry against the scripted tree: numbering (A1), the generation window and its
//! invalidating events, and the re-identification ladder.

mod numbering;
mod precedence;
mod resolve;
mod window;

use omo_computer_core::ax::{walk, AxReader, Limits};

use super::testkit::Tree;
use super::RefRegistry;

/// Observes `window` once: a full walk minted as a new generation; returns its number.
fn snap(tree: &mut Tree, refs: &mut RefRegistry, window: &str) -> u64 {
    let root = tree.root(window).expect("root");
    let limits = Limits::of(tree);
    let read = walk(tree, root.node.clone(), &limits);
    refs.mint(&root, &read, None).generation
}

/// `(title, n)` of every element of generation `number`, in document order.
fn numbers(refs: &RefRegistry, window: &str, number: u64) -> Vec<(String, u64)> {
    refs.generation(window, number)
        .expect("generation")
        .entries
        .iter()
        .map(|entry| (entry.read.title.clone().unwrap_or_default(), entry.n))
        .collect()
}

fn n_of(refs: &RefRegistry, window: &str, number: u64, title: &str) -> u64 {
    numbers(refs, window, number)
        .into_iter()
        .find(|(t, _)| t == title)
        .unwrap_or_else(|| panic!("{title} in s{number}"))
        .1
}
