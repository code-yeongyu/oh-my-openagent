use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DesktopWindow;

/// One installed or running application: its stable identity (the bundle id,
/// or the native path when the bundle has none) with the process state
/// observable right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: String,
    pub name: String,
    pub path: String,
    pub running: bool,
    /// The process id while the application runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

/// `apps.open`'s result: the opened application's [`Application`] fields and
/// the window it shows (`null` until it shows one, or when the window list
/// cannot tell).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenedApplication {
    pub id: String,
    pub name: String,
    pub path: String,
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub window: Option<DesktopWindow>,
}

impl OpenedApplication {
    #[must_use]
    pub fn new(application: Application, window: Option<DesktopWindow>) -> Self {
        let Application { id, name, path, running, pid } = application;
        Self { id, name, path, running, pid, window }
    }
}
