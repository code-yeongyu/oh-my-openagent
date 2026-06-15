import type { ProjectLocalCodexCleanupResult } from "./codex-project-local-cleanup"

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
  readonly env?: NodeJS.ProcessEnv
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
) => Promise<void>

export type CodexInstallPlatform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd"

export type GitBashResolution =
  | {
    readonly found: true
    readonly path: string | null
    readonly source: "not-required" | "env" | "program-files" | "program-files-x86" | "path"
  }
  | {
    readonly found: false
    readonly checkedPaths: readonly string[]
    readonly installHint: string
  }

export type GitBashResolver = () => GitBashResolution

export interface CodexInstallOptions {
  readonly codexHome?: string
  readonly binDir?: string
  readonly repoRoot?: string
  readonly projectDirectory?: string
  readonly platform?: CodexInstallPlatform
  readonly env?: { readonly [key: string]: string | undefined }
  readonly gitBashResolver?: GitBashResolver
  readonly autonomousPermissions?: boolean
  readonly runCommand?: RunCommand
  readonly log?: (message: string) => void
}

export interface CodexInstallResult {
  readonly marketplaceName: string
  readonly installed: readonly InstalledPlugin[]
  readonly configPath: string
  readonly codexHome: string
  readonly gitBashPath: string | null
  readonly projectCleanup: ProjectLocalCodexCleanupResult
}
