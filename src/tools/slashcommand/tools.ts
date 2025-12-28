import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename, dirname } from "path"
import { parseFrontmatter, resolveCommandsInText, resolveFileReferencesInText, sanitizeModelField } from "../../shared"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import type { CommandScope, CommandMetadata, CommandInfo } from "./types"

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
      const { data, body } = parseFrontmatter(content)

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

function discoverCommandsSync(): CommandInfo[] {
  const { homedir } = require("os")
  const userCommandsDir = join(getClaudeConfigDir(), "commands")
  const projectCommandsDir = join(process.cwd(), ".claude", "commands")
  const opencodeGlobalDir = join(homedir(), ".config", "opencode", "command")
  const opencodeProjectDir = join(process.cwd(), ".opencode", "command")

  const userCommands = discoverCommandsFromDir(userCommandsDir, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir(opencodeGlobalDir, "opencode")
  const projectCommands = discoverCommandsFromDir(projectCommandsDir, "project")
  const opencodeProjectCommands = discoverCommandsFromDir(opencodeProjectDir, "opencode-project")

  return [...opencodeProjectCommands, ...projectCommands, ...opencodeGlobalCommands, ...userCommands]
}

const availableCommands = discoverCommandsSync()
const commandListForDescription = availableCommands
  .map((cmd) => {
    const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
    return `- /${cmd.name}${hint}: ${cmd.metadata.description} (${cmd.scope})`
  })
  .join("\n")

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

  const commandDir = dirname(cmd.path)
  const withFileRefs = await resolveFileReferencesInText(cmd.content, commandDir)
  const resolvedContent = await resolveCommandsInText(withFileRefs)
  sections.push(resolvedContent.trim())

  return sections.join("\n")
}

function formatCommandList(commands: CommandInfo[]): string {
  if (commands.length === 0) {
    return "No commands found."
  }

  const lines = ["# Available Commands\n"]

  for (const cmd of commands) {
    const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
    lines.push(
      `- **/${cmd.name}${hint}**: ${cmd.metadata.description || "(no description)"} (${cmd.scope})`
    )
  }

  lines.push(`\n**Total**: ${commands.length} commands`)
  return lines.join("\n")
}

export const slashcommand: ToolDefinition = tool({
  description: `Execute a slash command within the main conversation.

When you use this tool, the slash command gets expanded to a full prompt that provides detailed instructions on how to complete the task.

How slash commands work:
- Invoke commands using this tool with the command name (without arguments)
- The command's prompt will expand and provide detailed instructions
- Arguments from user input should be passed separately

Important:
- Only use commands listed in Available Commands below
- Do not invoke a command that is already running
- **CRITICAL**: When user's message starts with '/' (e.g., "/commit", "/plan"), you MUST immediately invoke this tool with that command. Do NOT attempt to handle the command manually.

Commands are loaded from (priority order, highest wins):
- .opencode/command/ (opencode-project - OpenCode project-specific commands)
- ./.claude/commands/ (project - Claude Code project-specific commands)
- ~/.config/opencode/command/ (opencode - OpenCode global commands)
- $CLAUDE_CONFIG_DIR/commands/ or ~/.claude/commands/ (user - Claude Code global commands)

Each command is a markdown file with:
- YAML frontmatter: description, argument-hint, model, agent, subtask (optional)
- Markdown body: The command instructions/prompt
- File references: @path/to/file (relative to command file location)
- Shell injection: \`!\`command\`\` (executes and injects output)

Available Commands:
${commandListForDescription}`,

  args: {
    command: tool.schema
      .string()
      .describe(
        "The slash command to execute (without the leading slash). E.g., 'commit', 'plan', 'execute'."
      ),
  },

  async execute(args) {
    const commands = discoverCommandsSync()

    if (!args.command) {
      return formatCommandList(commands) + "\n\nProvide a command name to execute."
    }

    const cmdName = args.command.replace(/^\//, "")

    const exactMatch = commands.find(
      (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase()
    )

    if (exactMatch) {
      return await formatLoadedCommand(exactMatch)
    }

    const partialMatches = commands.filter((cmd) =>
      cmd.name.toLowerCase().includes(cmdName.toLowerCase())
    )

    if (partialMatches.length > 0) {
      const matchList = partialMatches.map((cmd) => `/${cmd.name}`).join(", ")
      return (
        `No exact match for "/${cmdName}". Did you mean: ${matchList}?\n\n` +
        formatCommandList(commands)
      )
    }

    return (
      `Command "/${cmdName}" not found.\n\n` +
      formatCommandList(commands) +
      "\n\nTry a different command name."
    )
  },
})
