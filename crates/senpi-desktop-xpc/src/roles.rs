/// Compiled release identities, not an extensible caller allowlist.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    NativeController,
    EngineServer,
}

pub const TEAM_IDENTIFIER: &str = "523JNR86LZ";
pub const SECURITY_EPOCH_KEY: &str = "OmODesktopSecurityEpoch";
pub const SECURITY_EPOCH: &str = "xpc-1";

impl Role {
    /// Reserved native controller identity; no controller ships in O1.
    pub const fn identifier(self) -> &'static str {
        match self {
            Self::NativeController => "ai.sisyphuslabs.senpi-desktop-controller.xpc-v1",
            Self::EngineServer => "ai.sisyphuslabs.senpi-desktop-engine.xpc-v1",
        }
    }

    pub fn requirement(self) -> String {
        format!(
            "anchor apple generic and certificate leaf[subject.OU] = \"{TEAM_IDENTIFIER}\" \
             and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
             and certificate leaf[field.1.2.840.113635.100.6.1.13] exists \
             and identifier \"{}\"",
            self.identifier()
        )
    }
}
