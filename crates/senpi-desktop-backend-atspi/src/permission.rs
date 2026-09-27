//! `axPermission` on Linux: whether accessibility works, and if not, which
//! of the two setup steps is missing.

use crate::bus::{AtSpiBus, BusResult};
use crate::AtSpiAx;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AxPermission {
    /// No accessibility bus: no `org.a11y.Bus` on the session bus and no
    /// `AT_SPI_BUS_ADDRESS`, or the registry does not answer.
    BusUnreachable,
    /// The bus answers but no application publishes a tree: toolkits only do
    /// so with `org.a11y.Status IsEnabled`, `GTK_MODULES=gail:atk-bridge`, or
    /// `QT_ACCESSIBILITY=1`.
    ToolkitsSilent,
    /// At least one application publishes its tree.
    Granted,
}

impl AxPermission {
    /// The permission of a backend's optional AT-SPI half; `None` is what
    /// `AtSpiAx::new().ok()` yields without a bus.
    pub fn of<B: AtSpiBus>(ax: Option<&mut AtSpiAx<B>>) -> Self {
        ax.map_or(Self::BusUnreachable, AtSpiAx::permission)
    }

    /// Classifies a registry children read.
    pub(crate) fn from_applications(applications: BusResult<usize>) -> Self {
        match applications {
            Err(_) => Self::BusUnreachable,
            Ok(0) => Self::ToolkitsSilent,
            Ok(_) => Self::Granted,
        }
    }

    /// The `DesktopCapabilities.ax_permission` label.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BusUnreachable => "bus-unreachable",
            Self::ToolkitsSilent => "toolkits-silent",
            Self::Granted => "granted",
        }
    }

    /// `DesktopCapabilities.ax`: accessibility is usable right now.
    pub const fn is_granted(self) -> bool {
        matches!(self, Self::Granted)
    }
}
