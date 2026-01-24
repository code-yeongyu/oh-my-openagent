import { promises as fs, type Dirent } from "fs"
import { join, basename } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir, getOpenCodeConfigDir } from "../../shared"
import { log } from "../../shared/logger"
import type { CommandScope, CommandDefinition, CommandFrontmatter, LoadedCommand } from "./types"

async function loadCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
  visited: Set<string> = new Set(),
  prefix: string = ""
): Promise<LoadedCommand[]> {
  try {
    await fs.access(commandsDir)
  } catch {
    return []
  }

  let realPath: string
  try {
    realPath = await fs.realpath(commandsDir)
  } catch (error) {
    log(`Failed to resolve command directory: ${commandsDir}`, error)
    return []
  }

  if (visited.has(realPath)) {
    return []
  }
  visited.add(realPath)

  let entries: Dirent[]
  try {
    entries = await fs.readdir(commandsDir, { withFileTypes: true })
  } catch (error) {
    log(`Failed to read command directory: ${commandsDir}`, error)
    return []
  }

  const commands: LoadedCommand[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue
      const subDirPath = join(commandsDir, entry.name)
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name
      const subCommands = await loadCommandsFromDir(subDirPath, scope, visited, subPrefix)
      commands.push(...subCommands)
      continue
    }

    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const baseCommandName = basename(entry.name, ".md")
    const commandName = prefix ? `${prefix}:${baseCommandName}` : baseCommandName

    try {
      const content = await fs.readFile(commandPath, "utf-8")
      const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

      const wrappedTemplate = `<command-instruction>
${body.trim()}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

      const formattedDescription = `(${scope}) ${data.description || ""}`

      const isOpencodeSource = scope === "opencode" || scope === "opencode-project"
      const definition: CommandDefinition = {
        name: commandName,
        description: formattedDescription,
        template: wrappedTemplate,
        agent: data.agent,
        model: sanitizeModelField(data.model, isOpencodeSource ? "opencode" : "claude-code"),
        subtask: data.subtask,
        argumentHint: data["argument-hint"],
        handoffs: data.handoffs,
      }

      commands.push({
        name: commandName,
        path: commandPath,
        definition,
        scope,
      })
    } catch (error) {
      log(`Failed to parse command: ${commandPath}`, error)
      continue
    }
  }

  return commands
}

function commandsToRecord(commands: LoadedCommand[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const cmd of commands) {
    const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = cmd.definition
    result[cmd.name] = openCodeCompatible as CommandDefinition
  }
  return result
}

export async function loadUserCommands(): Promise<Record<string, CommandDefinition>> {
  const userCommandsDir = join(getClaudeConfigDir(), "commands")
  const commands = await loadCommandsFromDir(userCommandsDir, "user")
  return commandsToRecord(commands)
}

export async function loadProjectCommands(): Promise<Record<string, CommandDefinition>> {
  const projectCommandsDir = join(process.cwd(), ".claude", "commands")
  const commands = await loadCommandsFromDir(projectCommandsDir, "project")
  return commandsToRecord(commands)
}

export async function loadOpencodeGlobalCommands(): Promise<Record<string, CommandDefinition>> {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const opencodeCommandsDir = join(configDir, "command")
  const commands = await loadCommandsFromDir(opencodeCommandsDir, "opencode")
  return commandsToRecord(commands)
}

export async function loadOpencodeProjectCommands(): Promise<Record<string, CommandDefinition>> {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "command")
  const commands = await loadCommandsFromDir(opencodeProjectDir, "opencode-project")
  return commandsToRecord(commands)
}

export async function loadAllCommands(): Promise<Record<string, CommandDefinition>> {
  const [user, project, global, projectOpencode] = await Promise.all([
    loadUserCommands(),
    loadProjectCommands(),
    loadOpencodeGlobalCommands(),
    loadOpencodeProjectCommands(),
  ])
  return { ...projectOpencode, ...global, ...project, ...user }
}
