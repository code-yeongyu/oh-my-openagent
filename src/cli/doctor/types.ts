export type CheckStatus = "pass" | "fail" | "warn" | "skip"

export interface CheckResult {
  name: string
  status: CheckStatus
  message: string
  details?: string[]
  duration?: number
}

export type CheckFunction = () => Promise<CheckResult>

export type CheckCategory =
  | "installation"
  | "configuration"
  | "authentication"
  | "dependencies"
  | "tools"
  | "updates"

export interface CheckDefinition {
  id: string
  name: string
  category: CheckCategory
  check: CheckFunction
  critical?: boolean
}

export interface DoctorOptions {
  verbose?: boolean
  json?: boolean
  category?: CheckCategory
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
  summary: DoctorSummary
  exitCode: number
}

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

export interface LspServerInfo {
  id: string
  installed: boolean
  extensions: string[]
  source: "builtin" | "config" | "plugin"
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
