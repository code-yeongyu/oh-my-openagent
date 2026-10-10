import type { LspComponentReport } from "@oh-my-opencode/lsp-core/lsp/component-check"

export type DoctorMode = "default" | "status" | "verbose"
export type DoctorTarget = "opencode" | "codex"

export interface DoctorComponentOptions {
  readonly cwd?: string
  /** LSP language ids (or aliases such as bash, ts, yml) that fail the doctor unless they work. */
  readonly requiredLanguages?: readonly string[]
  /** False resolves components without starting them. */
  readonly probe?: boolean
}

export interface DoctorOptions {
  mode: DoctorMode
  json?: boolean
  target?: DoctorTarget
  components?: DoctorComponentOptions
}

export interface DoctorIssue {
  title: string
  description: string
  fix?: string
  affects?: string[]
  severity: "error" | "warning"
}

export type CheckStatus = "pass" | "fail" | "warn" | "skip"

export interface CheckResult {
  name: string
  status: CheckStatus
  message: string
  details?: string[]
  issues: DoctorIssue[]
  duration?: number
}

export type CheckFunction = () => Promise<CheckResult>

export interface CheckDefinition {
  id: string
  name: string
  check: CheckFunction
  critical?: boolean
}

export interface SystemInfo {
  opencodeVersion: string | null
  opencodePath: string | null
  pluginVersion: string | null
  loadedVersion: string | null
  bunVersion: string | null
  configPath: string | null
  configValid: boolean
  isLocalDev: boolean
}

export interface ToolsSummary {
  lspServers: Array<{ id: string; extensions: string[] }>
  astGrepCli: boolean
  commentChecker: boolean
  ghCli: { installed: boolean; authenticated: boolean; username: string | null }
  mcpBuiltin: string[]
  mcpUser: string[]
}

export interface DoctorSummary {
  total: number
  passed: number
  failed: number
  warnings: number
  skipped: number
  duration: number
}

export interface DoctorResult {
  results: CheckResult[]
  systemInfo: SystemInfo
  tools: ToolsSummary
  summary: DoctorSummary
  exitCode: number
  target?: DoctorTarget
  codex?: CodexDoctorSummary
  /** Latest published version on the installed channel; null when the registry lookup failed. */
  latestVersion: string | null
  /** Per-component functional results (OpenCode target only). */
  components?: ComponentsReport
}

/**
 * `ok` = exercised and worked, `present` = found but only presence can be checked, `missing` =
 * not installed, `failed` = installed but did not work, `unauthenticated` = gh without a login,
 * `skipped` = the component is disabled in the OMO config.
 */
export type ToolComponentStatus = "ok" | "present" | "missing" | "failed" | "unauthenticated" | "skipped"

export type ToolComponentId = "lsp-bridge" | "ast-grep" | "comment-checker" | "gh"

export interface ToolComponentReport {
  readonly id: ToolComponentId
  readonly status: ToolComponentStatus
  readonly path: string | null
  readonly version: string | null
  /** The account a credentialed tool runs as (gh), never a token. */
  readonly account?: string | null
  readonly detail: string
  readonly remediation: readonly string[]
}

export interface ComponentsReport {
  readonly cwd: string
  readonly probed: boolean
  readonly requiredLanguages: readonly string[]
  /** Null when the LSP tools bridge is disabled, so no language can use LSP at all. */
  readonly lsp: LspComponentReport | null
  readonly tools: readonly ToolComponentReport[]
}

export interface CodexConfigSummary {
  readonly exists: boolean
  readonly marketplaceConfigured: boolean
  readonly pluginEnabled: boolean
  readonly pluginsFeatureEnabled: boolean
  readonly pluginHooksFeatureEnabled: boolean
  readonly companionPluginEnabled: boolean
  readonly companionLifecycleHookStateEvents: readonly string[]
}

export interface CodexDoctorSummary {
  readonly codexPath: string | null
  readonly codexSource: string | null
  readonly codexAppId: string | null
  readonly marketplaceName: string
  readonly pluginName: string
  readonly pluginVersion: string | null
  readonly pluginVersionStamped: boolean
  readonly installerVersion: string
  readonly packageName: string | null
  readonly packageVersion: string | null
  readonly pluginRoot: string | null
  readonly configPath: string
  readonly config: CodexConfigSummary
  readonly linkedBins: readonly string[]
  readonly agents: readonly string[]
}

export type CheckCategory =
  | "installation"
  | "configuration"
  | "authentication"
  | "dependencies"
  | "tools"
  | "updates"

export interface OpenCodeInfo {
  installed: boolean
  version: string | null
  path: string | null
  binary: "opencode" | "opencode-desktop" | null
}

export interface PluginInfo {
  registered: boolean
  configPath: string | null
  entry: string | null
  isPinned: boolean
  pinnedVersion: string | null
}

export interface ConfigInfo {
  exists: boolean
  path: string | null
  format: "json" | "jsonc" | null
  valid: boolean
  errors: string[]
}

export type AuthProviderId = "anthropic" | "openai" | "google"

export interface AuthProviderInfo {
  id: AuthProviderId
  name: string
  pluginInstalled: boolean
  configured: boolean
  error?: string
}

export interface DependencyInfo {
  name: string
  required: boolean
  installed: boolean
  version: string | null
  path: string | null
  installHint?: string
}

export interface McpServerInfo {
  id: string
  type: "builtin" | "user"
  enabled: boolean
  valid: boolean
  error?: string
}

export interface VersionCheckInfo {
  currentVersion: string | null
  latestVersion: string | null
  isUpToDate: boolean
  isLocalDev: boolean
  isPinned: boolean
}
