import type { CodexCleanupOptions } from "../src/install/codex-cleanup"
import type { CodexInstallOptions } from "../src/install/types"

export interface CodexSandboxEnv {
  readonly [key: string]: string | undefined
  readonly HOME: string
  readonly USERPROFILE: string
  readonly CODEX_HOME: string
  readonly CODEX_LOCAL_BIN_DIR: string
  readonly OMO_CODEX_PROJECT: string
  readonly XDG_CONFIG_HOME: string
  readonly XDG_DATA_HOME: string
  readonly XDG_STATE_HOME: string
  readonly XDG_CACHE_HOME: string
  readonly XDG_BIN_HOME: string
  readonly DO_NOT_TRACK: string
}

export interface CodexInstallSandbox {
  readonly root: string
  readonly home: string
  readonly codexHome: string
  readonly binDir: string
  readonly projectDirectory: string
  readonly env: CodexSandboxEnv
  path(...parts: readonly string[]): string
  dir(...parts: readonly string[]): string
  options(
    overrides?: CodexInstallOptions & CodexCleanupOptions & { readonly withoutBinDir?: boolean },
  ): CodexInstallOptions & CodexCleanupOptions
  spawnEnv(overrides?: Readonly<Record<string, string>>): Record<string, string>
  dispose(): void
}

export function createCodexInstallSandbox(name?: string): CodexInstallSandbox
export function disposeCodexInstallSandboxes(): void
export function makeTempDir(): Promise<string>
export function writeJson(path: string, value: unknown): Promise<void>
export function writePlugin(root: string, name: string, version: string): Promise<void>
export function writePluginAt(pluginRoot: string, name: string, version: string): Promise<void>
