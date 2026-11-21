//! The checks on each stamped line (A-IS-62 R7-2, R7-4): the hand, the writer key's segment
//! (`audit.meta` first, then `seq` with no gap or repeat and `prev` linking within the key), the
//! line's own `lineHash`, the `rotation_anchor`'s link to the line before it, and the mark.

use std::collections::HashMap;

use serde_json::Value;

use super::Tamper;
use crate::audit::chain::line_hash;
use crate::audit::mark::{carries_mark, is_anchor};

#[derive(Debug, Clone)]
struct Key {
    seq: u64,
    prev: String,
}

/// The chain state a process keeps across its reads of one hand.
#[derive(Debug, Default)]
pub(super) struct Chain {
    keys: HashMap<(u64, u64), Key>,
    /// The `lineHash` of the last stamped line read, in read order across both files.
    last: Option<String>,
    pub(super) marked: bool,
}

impl Chain {
    /// Checks one line of the hand `hand` and advances the chain.
    pub(super) fn line(&mut self, bytes: &[u8], hand: &str) -> Result<(), Tamper> {
        let line: Value = serde_json::from_slice(bytes).map_err(|_| Tamper::Unparseable)?;
        if line["handId"].as_str() != Some(hand) {
            return Err(Tamper::ForeignHand);
        }
        let key = match (line["writerPid"].as_u64(), line["writerProcStartMs"].as_u64()) {
            (Some(pid), Some(start)) => (pid, start),
            _ => return Err(Tamper::Unparseable),
        };
        if line["kind"] == "audit.meta" {
            self.keys.insert(key, Key { seq: 0, prev: "meta".to_owned() });
            return Ok(());
        }
        let state = self.keys.get_mut(&key).ok_or(Tamper::NoMeta)?;
        let (Some(seq), Some(hash), Some(prev)) =
            (line["seq"].as_u64(), line["lineHash"].as_str(), line["prev"].as_str())
        else {
            return Err(Tamper::Unparseable);
        };
        if seq != state.seq + 1 {
            return Err(Tamper::Seq);
        }
        if line_hash(&line) != hash {
            return Err(Tamper::Prev);
        }
        if is_anchor(&line) && seq == 1 {
            // An anchor links to the line before it, in the retired file after a rotation. One
            // that opens the first file this read sees links to a file already rotated away:
            // nothing read can check it.
            if self.last.as_deref().is_some_and(|last| prev != last) {
                return Err(Tamper::AnchorLink);
            }
        } else if prev != state.prev {
            return Err(Tamper::Prev);
        }
        state.seq = seq;
        state.prev = hash.to_owned();
        self.last = Some(hash.to_owned());
        self.marked |= carries_mark(&line);
        Ok(())
    }
}
