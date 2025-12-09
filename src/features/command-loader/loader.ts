import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { join, basename } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import type { CommandScope, CommandDefinition, CommandFrontmatter, LoadedCommand } from "./types"

function isMarkdownFile(entry: { name: string; isFile: () => boolean }): boolean {
  return !entry.name.startsWith(".") && entry.name.endsWith(".md") && entry.isFile()
}

function loadCommandsFromDir(commandsDir: string, scope: CommandScope): LoadedCommand[] {
  if (!existsSync(commandsDir)) {
    return []
  }

  const entries = readdirSync(commandsDir, { withFileTypes: true })
  const commands: LoadedCommand[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const commandName = basename(entry.name, ".md")

    try {
      const content = readFileSync(commandPath, "utf-8")
      const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

      const wrappedTemplate = `<command-instruction>
${body.trim()}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

      const formattedDescription = `(${scope}) ${data.description || ""}`

      const definition: CommandDefinition = {
        name: commandName,
        description: formattedDescription,
        template: wrappedTemplate,
        agent: data.agent,
        model: sanitizeModelField(data.model),
        subtask: data.subtask,
        argumentHint: data["argument-hint"],
      }

      commands.push({
        name: commandName,
        path: commandPath,
        definition,
        scope,
      })
    } catch {
      continue
    }
  }

  return commands
}

function commandsToRecord(commands: LoadedCommand[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const cmd of commands) {
    result[cmd.name] = cmd.definition
  }
  return result
}

export function loadUserCommands(): Record<string, CommandDefinition> {
  const userCommandsDir = join(homedir(), ".claude", "commands")
  const commands = loadCommandsFromDir(userCommandsDir, "user")
  return commandsToRecord(commands)
}

export function loadProjectCommands(): Record<string, CommandDefinition> {
  const projectCommandsDir = join(process.cwd(), ".claude", "commands")
  const commands = loadCommandsFromDir(projectCommandsDir, "project")
  return commandsToRecord(commands)
}

export function loadOpencodeGlobalCommands(): Record<string, CommandDefinition> {
  const opencodeCommandsDir = join(homedir(), ".config", "opencode", "command")
  const commands = loadCommandsFromDir(opencodeCommandsDir, "opencode")
  return commandsToRecord(commands)
}

export function loadOpencodeProjectCommands(): Record<string, CommandDefinition> {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "command")
  const commands = loadCommandsFromDir(opencodeProjectDir, "opencode-project")
  return commandsToRecord(commands)
}
