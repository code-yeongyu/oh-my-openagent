/**
 * Claude Code Plugin Types
 * 
 * Type definitions for Claude Code plugin system compatibility.
 * Based on https://code.claude.com/docs/en/plugins-reference
 */

export type PluginScope = "user" | "project" | "local" | "managed"

/**
 * Plugin installation entry in installed_plugins.json
 */
export interface PluginInstallation {
  scope: PluginScope
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  gitCommitSha?: string
  isLocal?: boolean
}

/**
 * Installed plugins database v1 (legacy)
 * plugins stored as direct objects
 */
export interface InstalledPluginsDatabaseV1 {
  version: 1
  plugins: Record<string, PluginInstallation>
}

/**
 * Installed plugins database v2 (current)
 * plugins stored as arrays
 */
export interface InstalledPluginsDatabaseV2 {
  version: 2
  plugins: Record<string, PluginInstallation[]>
}

/**
 * Installed plugins database structure
 * Located at ~/.claude/plugins/installed_plugins.json
 */
export type InstalledPluginsDatabase = InstalledPluginsDatabaseV1 | InstalledPluginsDatabaseV2

/**
 * Plugin author information
 */
export interface PluginAuthor {
  name?: string
  email?: string
  url?: string
}

/**
 * Plugin manifest (plugin.json)
 * Located at <plugin_root>/.claude-plugin/plugin.json
 */
export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: PluginAuthor
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  
  // Component paths (can be string or array)
  commands?: string | string[]
  agents?: string | string[]
  skills?: string | string[]
  hooks?: string | HooksConfig
  mcpServers?: string | McpServersConfig
  lspServers?: string | LspServersConfig
  outputStyles?: string | string[]
}

/**
 * Hooks configuration
 */
export interface HookEntry {
  type: "command" | "prompt" | "agent"
  command?: string
  prompt?: string
  agent?: string
}

export interface HookMatcher {
  matcher?: string
  hooks: HookEntry[]
}

export interface HooksConfig {
  hooks?: {
    PreToolUse?: HookMatcher[]
    PostToolUse?: HookMatcher[]
    PostToolUseFailure?: HookMatcher[]
    PermissionRequest?: HookMatcher[]
    UserPromptSubmit?: HookMatcher[]
    Notification?: HookMatcher[]
    Stop?: HookMatcher[]
    SubagentStart?: HookMatcher[]
    SubagentStop?: HookMatcher[]
    SessionStart?: HookMatcher[]
    SessionEnd?: HookMatcher[]
    PreCompact?: HookMatcher[]
  }
}

/**
 * MCP servers configuration in plugin
 */
export interface PluginMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  type?: "stdio" | "http" | "sse"
  disabled?: boolean
}

export interface McpServersConfig {
  mcpServers?: Record<string, PluginMcpServer>
}

/**
 * LSP server configuration
 */
export interface LspServerConfig {
  command: string
  args?: string[]
  extensionToLanguage: Record<string, string>
  transport?: "stdio" | "socket"
  env?: Record<string, string>
  initializationOptions?: Record<string, unknown>
  settings?: Record<string, unknown>
  workspaceFolder?: string
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  loggingConfig?: {
    args?: string[]
    env?: Record<string, string>
  }
}

export interface LspServersConfig {
  [language: string]: LspServerConfig
}

/**
 * Loaded plugin with all resolved components
 */
export interface LoadedPlugin {
  name: string
  version: string
  scope: PluginScope
  installPath: string
  manifest?: PluginManifest
  pluginKey: string
  
  // Resolved paths for components
  commandsDir?: string
  agentsDir?: string
  skillsDir?: string
  hooksPath?: string
  mcpPath?: string
  lspPath?: string
}

/**
 * Plugin load result with all components
 */
export interface PluginLoadResult {
  plugins: LoadedPlugin[]
  errors: PluginLoadError[]
}

export interface PluginLoadError {
  pluginKey: string
  installPath: string
  error: string
}

/**
 * Claude settings from ~/.claude/settings.json
 */
export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>
  // Other settings we don't use
  [key: string]: unknown
}

/**
 * Plugin loader options
 */
export interface PluginLoaderOptions {
  /**
   * Override enabled plugins from oh-my-opencode config.
   * Key format: "pluginName@marketplace" (e.g., "shell-scripting@claude-code-workflows")
   * Value: true = enabled, false = disabled
   * 
   * This takes precedence over ~/.claude/settings.json enabledPlugins
   */
  enabledPluginsOverride?: Record<string, boolean>
}
