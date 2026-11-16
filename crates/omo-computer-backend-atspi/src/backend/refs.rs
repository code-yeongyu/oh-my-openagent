//! The refs an observe minted: `s<generation>:e<n>` bound to the bus object, the role and the
//! evidence tuple. Re-identification is proven from the cached snapshot: a tuple two cached
//! elements share is ambiguous, an object gone from the bus is stale.

use std::collections::{BTreeMap, HashSet};

use omo_computer_core::ax::{NodeRead, RefToken, GENERATIONS_PER_WINDOW};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::reader::Handles;
use crate::bus::NodeId;
use crate::types::{AxRefusal, Detail};

/// What a ref names: the object, the role, and the identity evidence it was minted with.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RefEntry {
    pub node: Option<NodeId>,
    pub native_role: String,
    pub actionable: bool,
    pub read: NodeRead,
    pub parent: Option<usize>,
}

impl RefEntry {
    pub fn of(
        node: Option<NodeId>,
        read: &NodeRead,
        parent: Option<usize>,
        actionable: &HashSet<NodeId>,
    ) -> Self {
        Self {
            actionable: node.as_ref().is_some_and(|id| actionable.contains(id)),
            node,
            native_role: read.native_role.clone().unwrap_or_default(),
            read: read.clone(),
            parent,
        }
    }

    /// `{role, stable text, native id}`: the tuple re-identification keys on (never the value).
    fn evidence(&self) -> (&str, Option<&str>, Option<&str>) {
        (
            self.native_role.as_str(),
            self.read.stable_text(),
            self.read.native_id.as_deref(),
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Generation {
    pub window: String,
    pub entries: Vec<RefEntry>,
}

#[derive(Debug, Default)]
pub(crate) struct RefTable {
    pub handles: Handles,
    /// Objects whose read showed the Action interface.
    pub actionable: HashSet<NodeId>,
    generations: BTreeMap<u64, Generation>,
    next: u64,
}

impl RefTable {
    pub fn next_generation(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    /// Mints an empty generation (a withheld secure observe still supersedes older refs).
    pub fn mint(&mut self, window: &str, entries: Vec<RefEntry>) -> u64 {
        let generation = self.next_generation();
        self.insert(generation, window, entries);
        generation
    }

    /// Keeps the last [`GENERATIONS_PER_WINDOW`] generations of `window`.
    pub fn insert(&mut self, generation: u64, window: &str, entries: Vec<RefEntry>) {
        self.generations.insert(
            generation,
            Generation {
                window: window.to_owned(),
                entries,
            },
        );
        let mine: Vec<u64> = self
            .generations
            .iter()
            .filter(|(_, g)| g.window == window)
            .map(|(n, _)| *n)
            .collect();
        for old in mine
            .iter()
            .take(mine.len().saturating_sub(GENERATIONS_PER_WINDOW))
        {
            self.generations.remove(old);
        }
    }

    /// The entry a ref names, unique within its cached generation.
    ///
    /// # Errors
    /// A bare or malformed token (`InvalidTarget{ref_unqualified}`), an expired generation or
    /// an element never minted (`StaleRef`), an evidence tuple two cached elements share
    /// (`AmbiguousTarget`), or an element without a bus object (`StaleRef`).
    pub fn entry(&self, token: &str) -> Result<(&Generation, &RefEntry), AxRefusal> {
        let stale = || AxRefusal::plain(Refusal::bare(EngineCode::StaleRef));
        let Some(RefToken::Qualified { generation, n }) = RefToken::parse(token) else {
            return Err(AxRefusal::plain(Refusal::new(
                EngineCode::InvalidTarget,
                Reason::RefUnqualified.wire(),
            )));
        };
        let found = self.generations.get(&generation).ok_or_else(stale)?;
        let index = usize::try_from(n - 1).map_err(|_| stale())?;
        let entry = found.entries.get(index).ok_or_else(stale)?;
        let twins = found
            .entries
            .iter()
            .filter(|other| other.evidence() == entry.evidence())
            .count();
        if twins > 1 {
            let detail = Detail::Matches { count: twins };
            return Err(AxRefusal::new(
                Refusal::bare(EngineCode::AmbiguousTarget),
                detail,
            ));
        }
        if entry.node.is_none() {
            return Err(stale());
        }
        Ok((found, entry))
    }
}
