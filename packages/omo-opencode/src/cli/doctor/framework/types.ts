export type DoctorMode = "default" | "status" | "verbose"
export type DoctorTarget = "opencode" | "codex"

export interface DoctorOptions {
  mode: DoctorMode
  json?: boolean
  target?: DoctorTarget
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
