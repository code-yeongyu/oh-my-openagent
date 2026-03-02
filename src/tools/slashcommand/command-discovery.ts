import { existsSync, readdirSync, readFileSync } from "fs"
import { basename, join } from "path"
import { parseFrontmatter, sanitizeModelField, getOpenCodeConfigDir } from "../../shared"
import type { CommandFrontmatter } from "../../features/claude-code-command-loader/types"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { loadBuiltinCommands } from "../../features/builtin-commands"
import {
  discoverInstalledPlugins,
  loadPluginCommands,
  loadPluginSkillsAsCommands,
} from "../../features/claude-code-plugin-loader"
import type { CommandInfo, CommandMetadata, CommandScope } from "./types"

export interface CommandDiscoveryOptions {
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
}

function discoverCommandsFromDir(commandsDir: string, scope: CommandScope): CommandInfo[] {
  if (!existsSync(commandsDir)) return []

  const entries = readdirSync(commandsDir, { withFileTypes: true })
  const commands: CommandInfo[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const commandName = basename(entry.name, ".md")

    try {
      const content = readFileSync(commandPath, "utf-8")
      const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

      const isOpencodeSource = scope === "opencode" || scope === "opencode-project"
      const metadata: CommandMetadata = {
        name: commandName,
        description: data.description || "",
        argumentHint: data["argument-hint"],
        model: sanitizeModelField(data.model, isOpencodeSource ? "opencode" : "claude-code"),
        agent: data.agent,
        subtask: Boolean(data.subtask),
      }

      commands.push({
        name: commandName,
        path: commandPath,
        metadata,
        content: body,
        scope,
      })
    } catch {
      continue
    }
  }

  return commands
}

function discoverPluginCommands(options?: CommandDiscoveryOptions): CommandInfo[] {
  if (options?.pluginsEnabled === false) {
    return []
  }

  const { plugins } = discoverInstalledPlugins({
    enabledPluginsOverride: options?.enabledPluginsOverride,
  })

  const pluginDefinitions = {
    ...loadPluginCommands(plugins),
    ...loadPluginSkillsAsCommands(plugins),
  }

  return Object.entries(pluginDefinitions).map(([name, definition]) => ({
    name,
    metadata: {
      name,
      description: definition.description || "",
      model: definition.model,
      agent: definition.agent,
      subtask: definition.subtask,
    },
    content: definition.template,
    scope: "plugin",
  }))
}

export function discoverCommandsSync(
  directory?: string,
  options?: CommandDiscoveryOptions,
): CommandInfo[] {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const userCommandsDir = join(getClaudeConfigDir(), "commands")
  const projectCommandsDir = join(directory ?? process.cwd(), ".claude", "commands")
  const opencodeGlobalDir = join(configDir, "command")
  const opencodeProjectDir = join(directory ?? process.cwd(), ".opencode", "command")

  const userCommands = discoverCommandsFromDir(userCommandsDir, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir(opencodeGlobalDir, "opencode")
  const projectCommands = discoverCommandsFromDir(projectCommandsDir, "project")
  const opencodeProjectCommands = discoverCommandsFromDir(opencodeProjectDir, "opencode-project")
  const pluginCommands = discoverPluginCommands(options)

  const builtinCommandsMap = loadBuiltinCommands()
  const builtinCommands: CommandInfo[] = Object.values(builtinCommandsMap).map((command) => ({
    name: command.name,
    metadata: {
      name: command.name,
      description: command.description || "",
      argumentHint: command.argumentHint,
      model: command.model,
      agent: command.agent,
      subtask: command.subtask,
    },
    content: command.template,
    scope: "builtin",
  }))

  return [
    ...projectCommands,
    ...userCommands,
    ...opencodeProjectCommands,
    ...opencodeGlobalCommands,
    ...builtinCommands,
    ...pluginCommands,
  ]
}
