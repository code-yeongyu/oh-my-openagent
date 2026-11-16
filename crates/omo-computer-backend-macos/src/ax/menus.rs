//! Menus (RED stub).

use omo_computer_core::backend::{BackendResult, Delivered, Refusal};
use omo_computer_core::error::EngineCode;

use super::reader::MacAx;
use super::seam::AxServer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub path: Vec<String>,
    pub enabled: bool,
}

impl<S: AxServer> MacAx<S> {
    /// # Errors
    /// Never (stub).
    pub fn menu(&mut self, pid: u32) -> BackendResult<Vec<MenuItem>> {
        let _ = pid;
        Ok(Vec::new())
    }

    /// # Errors
    /// Always (stub).
    pub fn select_menu(&mut self, pid: u32, path: &[&str]) -> BackendResult<Delivered> {
        let _ = (pid, path);
        Err(Refusal::bare(EngineCode::InvalidTarget))
    }
}
