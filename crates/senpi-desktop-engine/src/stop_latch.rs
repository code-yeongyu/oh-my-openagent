//! Persistent user stop. No clear operation and no production path override.
mod account;
mod files;

use std::{
    io,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

pub(crate) struct StopLatch {
    directory: PathBuf,
    committed: AtomicBool,
}

impl StopLatch {
    pub(crate) fn open() -> io::Result<Self> {
        #[cfg(not(test))]
        let directory =
            account::home()?.join("Library/Application Support/OmO/ComputerControl/xpc-v1");
        #[cfg(test)]
        let directory = crate::xpc_test_harness::state_dir();
        Ok(Self::load(directory))
    }

    #[cfg(test)]
    pub(crate) fn for_test(directory: PathBuf) -> Self {
        Self::load(directory)
    }

    fn load(directory: PathBuf) -> Self {
        let uid = account::uid();
        let stopped = match files::directory(&directory, uid)
            .and_then(|opened| files::read(&opened, uid))
        {
            Ok(stopped) => stopped,
            Err(error) => {
                eprintln!(
                    "senpi-desktop-engine: invalid global stop state; starting stopped: {error}"
                );
                true
            }
        };
        Self {
            directory,
            committed: AtomicBool::new(stopped),
        }
    }

    pub(crate) fn is_stopped(&self) -> bool {
        self.committed.load(Ordering::SeqCst)
    }

    fn persist(&self) -> io::Result<()> {
        if self.is_stopped() {
            return Ok(());
        }
        files::commit(&self.directory, account::uid())?;
        self.committed.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// A failed durable write must never return to publish a stop or send ACK.
    pub(crate) fn commit_or_exit(&self) {
        if let Err(error) = self.persist() {
            eprintln!(
                "senpi-desktop-engine: cannot persist global stop; refusing to continue: {error}"
            );
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests;
