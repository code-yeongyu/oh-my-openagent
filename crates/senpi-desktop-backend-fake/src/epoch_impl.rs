//! The fake's epoch source: the epoch moves its scripted `epoch_events` and
//! `displays_change` recorded, read from the op log so a session can check
//! them while the backend is busy.

use std::sync::Arc;

use senpi_desktop_core::backend::EpochSource;
use senpi_desktop_core::protocol_results::EpochReason as WireReason;

use crate::fake::FakeBackend;
use crate::scripting::EpochReason;
use crate::sink::{RecordingSink, SinkOp};

struct RecordedEpochs(RecordingSink);

impl EpochSource for RecordedEpochs {
    fn moves_since(&self, seen: usize) -> Vec<WireReason> {
        self.0
            .ops()
            .into_iter()
            .filter_map(|op| match op {
                SinkOp::EpochBumped { reason, .. } => Some(wire_reason(reason)),
                _ => None,
            })
            .skip(seen)
            .collect()
    }
}

/// The `epoch.changed` reason of a scripted epoch move.
pub(crate) const fn wire_reason(reason: EpochReason) -> WireReason {
    match reason {
        EpochReason::Display => WireReason::Display,
        EpochReason::Lock => WireReason::Lock,
        EpochReason::Sleep => WireReason::Sleep,
        EpochReason::Space => WireReason::Space,
        EpochReason::Restart => WireReason::EngineRestarted,
    }
}

impl FakeBackend {
    pub(crate) fn recorded_epochs(&self) -> Arc<dyn EpochSource> {
        Arc::new(RecordedEpochs(self.sink()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scenario::FakeScenario;
    use senpi_desktop_core::backend::Backend;

    #[test]
    fn the_source_lists_scripted_moves_from_the_seen_one_on() {
        // Given
        let mut fake = FakeBackend::new(FakeScenario::default());
        let source = fake.epoch_source().expect("the fake has an epoch source");
        assert!(source.moves_since(0).is_empty());
        // When
        fake.bump_epoch(EpochReason::Display);
        fake.bump_epoch(EpochReason::Restart);
        // Then
        assert_eq!(source.moves_since(0), [WireReason::Display, WireReason::EngineRestarted]);
        assert_eq!(source.moves_since(1), [WireReason::EngineRestarted]);
        assert!(source.moves_since(2).is_empty());
    }
}
