//! The `computer.*` settings table passed in `session.open` (design row C17).

mod limits;
mod model;
mod table;
mod values;

pub use limits::{FleetSettings, McpSettings, RunLimits};
pub use model::Settings;
pub use table::{admission_keys, SettingRow, SettingStatus, GROUPED_KEYS, SETTINGS_TABLE};
pub use values::{
    AppScope, AppScopeMode, AuditLog, CapturePolicyRow, CuaAdapter, CuaAdapterMode, ExactKeyTable,
    FullLiteral, HandSelector, Intervention, LinuxDisplayServer, Runtime, ScreenshotGc,
    SendOnEnterRule, SshHost, Tier, ToolkitClass, Trace,
};
