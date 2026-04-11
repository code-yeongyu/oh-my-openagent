import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { basename, join } from "path"
import {
  parseFrontmatter,
  sanitizeModelField,
  findProjectOpencodeCommandDirs,
  getOpenCodeCommandDirs,
  discoverPluginCommandDefinitions,
} from "../../shared"
import type { CommandFrontmatter } from "../../features/claude-code-command-loader/types"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir, log } from "../../shared"
import { loadBuiltinCommands } from "../../features/builtin-commands"
import type { CommandInfo, CommandMetadata, CommandScope } from "./types"

export interface CommandDiscoveryOptions {
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
}

const NESTED_COMMAND_SEPARATOR = "/"

function discoverCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
  prefix = "",
): CommandInfo[] {
  if (!existsSync(commandsDir)) return []
  if (!statSync(commandsDir).isDirectory()) {
    log(`[command-discovery] Skipping non-directory path: ${commandsDir}`)
    return []
  }

  const entries = readdirSync(commandsDir, { withFileTypes: true })
  const commands: CommandInfo[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue
      const nestedPrefix = prefix
        ? `${prefix}${NESTED_COMMAND_SEPARATOR}${entry.name}`
        : entry.name
      commands.push(
        ...discoverCommandsFromDir(join(commandsDir, entry.name), scope, nestedPrefix),
      )
      continue
    }

    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const baseCommandName = basename(entry.name, ".md")
    const commandName = prefix
      ? `${prefix}${NESTED_COMMAND_SEPARATOR}${baseCommandName}`
      : baseCommandName

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
  const pluginDefinitions = discoverPluginCommandDefinitions(options)

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

function deduplicateCommandInfosByName(commands: CommandInfo[]): CommandInfo[] {
  const seen = new Set<string>()
  const deduplicatedCommands: CommandInfo[] = []

  for (const command of commands) {
    if (seen.has(command.name)) {
      continue
    }

    seen.add(command.name)
    deduplicatedCommands.push(command)
  }

  return deduplicatedCommands
}

export function discoverCommandsSync(
  directory?: string,
  options?: CommandDiscoveryOptions,
): CommandInfo[] {
  const userCommandsDir = join(getClaudeConfigDir(), "commands")
  const projectCommandsDir = join(directory ?? process.cwd(), ".claude", "commands")
  const opencodeGlobalDirs = getOpenCodeCommandDirs({ binary: "opencode" })
  const opencodeProjectDirs = findProjectOpencodeCommandDirs(directory ?? process.cwd())

  const userCommands = discoverCommandsFromDir(userCommandsDir, "user")
  const opencodeGlobalCommands = opencodeGlobalDirs.flatMap((commandsDir) =>
    discoverCommandsFromDir(commandsDir, "opencode")
  )
  const projectCommands = discoverCommandsFromDir(projectCommandsDir, "project")
  const opencodeProjectCommands = opencodeProjectDirs.flatMap((commandsDir) =>
    discoverCommandsFromDir(commandsDir, "opencode-project"),
  )
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

  return deduplicateCommandInfosByName([
    ...projectCommands,
    ...userCommands,
    ...opencodeProjectCommands,
    ...opencodeGlobalCommands,
    ...builtinCommands,
    ...pluginCommands,
  ])
}
