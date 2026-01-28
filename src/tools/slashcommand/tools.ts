import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename, dirname } from "path"
import { parseFrontmatter, resolveCommandsInText, resolveFileReferencesInText, sanitizeModelField, getOpenCodeConfigDir } from "../../shared"
import type { CommandFrontmatter } from "../../features/claude-code-command-loader/types"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { discoverAllSkills, type LoadedSkill } from "../../features/opencode-skill-loader"
import { loadBuiltinCommands } from "../../features/builtin-commands"
import type { CommandScope, CommandMetadata, CommandInfo, SlashcommandToolOptions } from "./types"

function discoverCommandsFromDir(commandsDir: string, scope: CommandScope): CommandInfo[] {
  if (!existsSync(commandsDir)) {
    return []
  }

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

export function discoverCommandsSync(): CommandInfo[] {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const userCommandsDir = join(getClaudeConfigDir(), "commands")
  const projectCommandsDir = join(process.cwd(), ".claude", "commands")
  const opencodeGlobalDir = join(configDir, "command")
  const opencodeProjectDir = join(process.cwd(), ".opencode", "command")

  const userCommands = discoverCommandsFromDir(userCommandsDir, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir(opencodeGlobalDir, "opencode")
  const projectCommands = discoverCommandsFromDir(projectCommandsDir, "project")
  const opencodeProjectCommands = discoverCommandsFromDir(opencodeProjectDir, "opencode-project")

  const builtinCommandsMap = loadBuiltinCommands()
  const builtinCommands: CommandInfo[] = Object.values(builtinCommandsMap).map(cmd => ({
    name: cmd.name,
    metadata: {
      name: cmd.name,
      description: cmd.description || "",
      argumentHint: cmd.argumentHint,
      model: cmd.model,
      agent: cmd.agent,
      subtask: cmd.subtask
    },
    content: cmd.template,
    scope: "builtin"
  }))

  return [...builtinCommands, ...opencodeProjectCommands, ...projectCommands, ...opencodeGlobalCommands, ...userCommands]
}

function skillToCommandInfo(skill: LoadedSkill): CommandInfo {
  return {
    name: skill.name,
    path: skill.path,
    metadata: {
      name: skill.name,
      description: skill.definition.description || "",
      argumentHint: skill.definition.argumentHint,
      model: skill.definition.model,
      agent: skill.definition.agent,
      subtask: skill.definition.subtask,
    },
    content: skill.definition.template,
    scope: skill.scope,
    lazyContentLoader: skill.lazyContent,
  }
}

async function formatLoadedCommand(cmd: CommandInfo): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${cmd.name} Command\n`)

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`)
  }

  if (cmd.metadata.argumentHint) {
    sections.push(`**Usage**: /${cmd.name} ${cmd.metadata.argumentHint}\n`)
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`)
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`)
  }

  if (cmd.metadata.subtask) {
    sections.push(`**Subtask**: true\n`)
  }

  sections.push(`**Scope**: ${cmd.scope}\n`)
  sections.push("---\n")
  sections.push("## Command Instructions\n")

  let content = cmd.content || ""
  if (!content && cmd.lazyContentLoader) {
    content = await cmd.lazyContentLoader.load()
  }

  const commandDir = cmd.path ? dirname(cmd.path) : process.cwd()
  const withFileRefs = await resolveFileReferencesInText(content, commandDir)
  const resolvedContent = await resolveCommandsInText(withFileRefs)
  sections.push(resolvedContent.trim())

  return sections.join("\n")
}

function formatCommandList(items: CommandInfo[]): string {
  if (items.length === 0) {
    return "No commands or skills found."
  }

  const lines = ["# Available Commands & Skills\n"]

  for (const cmd of items) {
    const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
    lines.push(
      `- **/${cmd.name}${hint}**: ${cmd.metadata.description || "(no description)"} (${cmd.scope})`
    )
  }

  lines.push(`\n**Total**: ${items.length} items`)
  return lines.join("\n")
}

const TOOL_DESCRIPTION_PREFIX = `Load a skill to get detailed instructions for a specific task.

Skills provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's description.
`

function buildDescriptionFromItems(items: CommandInfo[]): string {
  const commandListForDescription = items
    .map((cmd) => {
      const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
      return `- /${cmd.name}${hint}: ${cmd.metadata.description} (${cmd.scope})`
    })
    .join("\n")

  return `${TOOL_DESCRIPTION_PREFIX}
<available_skills>
${commandListForDescription}
</available_skills>`
}

export function createSlashcommandTool(options: SlashcommandToolOptions = {}): ToolDefinition {
  let cachedCommands: CommandInfo[] | null = options.commands ?? null
  let cachedSkills: LoadedSkill[] | null = options.skills ?? null
  let cachedDescription: string | null = null

  const getCommands = (): CommandInfo[] => {
    if (cachedCommands) return cachedCommands
    cachedCommands = discoverCommandsSync()
    return cachedCommands
  }

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (cachedSkills) return cachedSkills
    cachedSkills = await discoverAllSkills()
    return cachedSkills
  }

  const getAllItems = async (): Promise<CommandInfo[]> => {
    const commands = getCommands()
    const skills = await getSkills()
    return [...commands, ...skills.map(skillToCommandInfo)]
  }

  const buildDescription = async (): Promise<string> => {
    if (cachedDescription) return cachedDescription
    const allItems = await getAllItems()
    cachedDescription = buildDescriptionFromItems(allItems)
    return cachedDescription
  }

  if (options.commands !== undefined && options.skills !== undefined) {
    const allItems = [...options.commands, ...options.skills.map(skillToCommandInfo)]
    cachedDescription = buildDescriptionFromItems(allItems)
  } else {
    buildDescription()
  }

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },

    args: {
      command: tool.schema
        .string()
        .describe(
          "The slash command to execute (without the leading slash). E.g., 'commit', 'plan', 'execute'."
        ),
    },

    async execute(args) {
      const allItems = await getAllItems()

      if (!args.command) {
        return formatCommandList(allItems) + "\n\nProvide a command or skill name to execute."
      }

      const cmdName = args.command.replace(/^\//, "")

      const exactMatch = allItems.find(
        (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase()
      )

      if (exactMatch) {
        return await formatLoadedCommand(exactMatch)
      }

      const partialMatches = allItems.filter((cmd) =>
        cmd.name.toLowerCase().includes(cmdName.toLowerCase())
      )

      if (partialMatches.length > 0) {
        const matchList = partialMatches.map((cmd) => `/${cmd.name}`).join(", ")
        return (
          `No exact match for "/${cmdName}\". Did you mean: ${matchList}?\n\n` +
          formatCommandList(allItems)
        )
      }

      return (
        `Command or skill "/${cmdName}" not found.\n\n` +
        formatCommandList(allItems) +
        "\n\nTry a different name."
      )
    },
  })
}

// Default instance for backward compatibility (lazy loading)
export const slashcommand: ToolDefinition = createSlashcommandTool()
