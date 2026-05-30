export interface MarketplacePluginSourceLocal {
  readonly source: "local"
  readonly path: string
}

export interface MarketplacePluginEntry {
  readonly name: string
  readonly source?: string | MarketplacePluginSourceLocal
}

export interface MarketplaceManifest {
  readonly name: string
  readonly plugins: readonly MarketplacePluginEntry[]
}

export interface PluginManifest {
  readonly name: string
  readonly version?: string
  readonly hooks?: string
}

export interface InstalledPlugin {
  readonly name: string
  readonly version: string
  readonly path: string
}

export interface TrustedHookState {
  readonly key: string
  readonly trustedHash: string
}

export type CodexMarketplaceSource =
  | {
    readonly sourceType: "git"
    readonly source: string
    readonly ref: string
  }
  | {
    readonly sourceType: "local"
    readonly source: string
  }

export interface CodexAgentConfig {
  readonly name: string
  readonly configFile: string
}

export interface CommandRunOptions {
  readonly cwd: string
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
) => Promise<void>

export interface CodexInstallOptions {
  readonly codexHome?: string
  readonly binDir?: string
  readonly repoRoot?: string
  readonly autonomousPermissions?: boolean
  readonly runCommand?: RunCommand
  readonly log?: (message: string) => void
}

export interface CodexInstallResult {
  readonly marketplaceName: string
  readonly installed: readonly InstalledPlugin[]
  readonly configPath: string
  readonly codexHome: string
}
