//! macOS tap invalidation on every executable exit path that can run code.

use std::future::Future;
use std::process::ExitCode;

use tokio::signal::unix::{signal, SignalKind};

pub(super) fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        // A caught panic may hold the registry/backend lock or be on a tap
        // thread. Invalidate ports synchronously, but never join here.
        senpi_desktop_backend_macos::invalidate_input_observers();
        previous(panic);
    }));
}

pub(super) enum Outcome {
    Completed,
    Terminated,
    Interrupted,
}

impl Outcome {
    pub(super) fn code(self) -> ExitCode {
        match self {
            Self::Completed => ExitCode::SUCCESS,
            Self::Terminated => ExitCode::from(143),
            Self::Interrupted => ExitCode::from(130),
        }
    }
}

pub(super) async fn run(work: impl Future<Output = Result<(), String>>) -> Result<Outcome, String> {
    // Register before polling work, so neither signal can race tap creation.
    let mut terminate = signal(SignalKind::terminate()).map_err(|error| error.to_string())?;
    let mut interrupt = signal(SignalKind::interrupt()).map_err(|error| error.to_string())?;
    let result = tokio::select! {
        result = work => result.map(|()| Outcome::Completed),
        _ = terminate.recv() => Ok(Outcome::Terminated),
        _ = interrupt.recv() => Ok(Outcome::Interrupted),
    };
    senpi_desktop_backend_macos::shutdown_input_observers();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_exits_remain_distinct_from_success_after_observer_shutdown() {
        for (outcome, code) in [
            (Outcome::Completed, 0_u8),
            (Outcome::Terminated, 143),
            (Outcome::Interrupted, 130),
        ] {
            assert_eq!(outcome.code(), ExitCode::from(code));
        }
    }
}
