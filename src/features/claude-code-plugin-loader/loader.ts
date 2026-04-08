import { log } from "../../shared/logger"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { McpServerConfig } from "../claude-code-mcp-loader/types"
import type { ClaudeCodeAgentConfig } from "../claude-code-agent-loader/types"
import type { HooksConfig, LoadedPlugin, PluginLoadError, PluginLoaderOptions } from "./types"
import { discoverInstalledPlugins } from "./discovery"
import { loadPluginCommands } from "./command-loader"
import { loadPluginSkillsAsCommands } from "./skill-loader"
import { loadPluginAgents } from "./agent-loader"
import { loadPluginMcpServers } from "./mcp-server-loader"
import { loadPluginHooksConfigs } from "./hook-loader"

export { discoverInstalledPlugins } from "./discovery"
export { loadPluginCommands } from "./command-loader"
export { loadPluginSkillsAsCommands } from "./skill-loader"
export { loadPluginAgents } from "./agent-loader"
export { loadPluginMcpServers } from "./mcp-server-loader"
export { loadPluginHooksConfigs } from "./hook-loader"

export interface PluginComponentsResult {
  commands: Record<string, CommandDefinition>
  skills: Record<string, CommandDefinition>
  agents: Record<string, ClaudeCodeAgentConfig>
  mcpServers: Record<string, McpServerConfig>
  hooksConfigs: HooksConfig[]
  plugins: LoadedPlugin[]
  errors: PluginLoadError[]
}

export interface PluginComponentLoadDeps {
  discoverInstalledPlugins: typeof discoverInstalledPlugins
  loadPluginCommands: typeof loadPluginCommands
  loadPluginSkillsAsCommands: typeof loadPluginSkillsAsCommands
  loadPluginAgents: typeof loadPluginAgents
  loadPluginMcpServers: typeof loadPluginMcpServers
  loadPluginHooksConfigs: typeof loadPluginHooksConfigs
}

const cachedPluginComponentsByKey = new Map<string, PluginComponentsResult>()

const defaultPluginComponentLoadDeps: PluginComponentLoadDeps = {
  discoverInstalledPlugins,
  loadPluginCommands,
  loadPluginSkillsAsCommands,
  loadPluginAgents,
  loadPluginMcpServers,
  loadPluginHooksConfigs,
}

function clonePluginComponentsResult(
  result: PluginComponentsResult,
): PluginComponentsResult {
  return structuredClone(result)
}

function isClaudeCodePluginsDisabled(): boolean {
  const disableFlag = process.env.OPENCODE_DISABLE_CLAUDE_CODE
  const disablePluginsFlag = process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS
  return disableFlag === "true" || disableFlag === "1" || disablePluginsFlag === "true" || disablePluginsFlag === "1"
}

function getPluginComponentsCacheKey(options?: PluginLoaderOptions): string {
  const overrideEntries = Object.entries(options?.enabledPluginsOverride ?? {})
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  return JSON.stringify({
    enabledPluginsOverride: overrideEntries,
  })
}

export function clearPluginComponentsCache(): void {
  cachedPluginComponentsByKey.clear()
}

async function loadAllPluginComponentsInternal(
  options?: PluginLoaderOptions,
  deps: PluginComponentLoadDeps = defaultPluginComponentLoadDeps,
): Promise<PluginComponentsResult> {
  if (isClaudeCodePluginsDisabled()) {
    log("Claude Code plugin loading disabled via OPENCODE_DISABLE_CLAUDE_CODE env var")
    return {
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [],
      plugins: [],
      errors: [],
    }
  }

  const cacheKey = getPluginComponentsCacheKey(options)
  const cachedPluginComponents = cachedPluginComponentsByKey.get(cacheKey)
  if (cachedPluginComponents) {
    return clonePluginComponentsResult(cachedPluginComponents)
  }

  const { plugins, errors } = deps.discoverInstalledPlugins(options)

  const [commands, skills, agents, mcpServers, hooksConfigs] = await Promise.all([
    Promise.resolve(deps.loadPluginCommands(plugins)),
    Promise.resolve(deps.loadPluginSkillsAsCommands(plugins)),
    Promise.resolve(deps.loadPluginAgents(plugins)),
    deps.loadPluginMcpServers(plugins),
    Promise.resolve(deps.loadPluginHooksConfigs(plugins)),
  ])

  log(`Loaded ${plugins.length} plugins with ${Object.keys(commands).length} commands, ${Object.keys(skills).length} skills, ${Object.keys(agents).length} agents, ${Object.keys(mcpServers).length} MCP servers`)

  const result = {
    commands,
    skills,
    agents,
    mcpServers,
    hooksConfigs,
    plugins,
    errors,
  }

  cachedPluginComponentsByKey.set(cacheKey, clonePluginComponentsResult(result))

  return clonePluginComponentsResult(result)
}

export async function loadAllPluginComponents(options?: PluginLoaderOptions): Promise<PluginComponentsResult> {
  return loadAllPluginComponentsInternal(options)
}

export async function loadAllPluginComponentsWithDeps(
  options: PluginLoaderOptions | undefined,
  deps: PluginComponentLoadDeps,
): Promise<PluginComponentsResult> {
  return loadAllPluginComponentsInternal(options, deps)
}
