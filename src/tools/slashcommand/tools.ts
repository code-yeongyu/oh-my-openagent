import { tool } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { join, basename, dirname } from "path"
import { parseFrontmatter, resolveCommandsInText, resolveFileReferencesInText, sanitizeModelField } from "../../shared"
import { commandPreflight, formatPreflightResult, type PreflightResult } from "../../shared/command-preflight"
import { isMarkdownFile } from "../../shared/file-utils"
import type { CommandScope, CommandMetadata, CommandInfo, CommandCategory } from "./types"

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
      const description = typeof data.description === "string" ? data.description : ""
      const argumentHint = typeof data["argument-hint"] === "string" ? data["argument-hint"] : undefined
      const model = typeof data.model === "string" ? data.model : undefined
      const agent = typeof data.agent === "string" ? data.agent : undefined
      const subtask = Boolean(data.subtask)
      const category = typeof data.category === "string" ? data.category as CommandCategory : undefined
      const primary = Boolean(data.primary)
      const step = typeof data.step === "string" ? data.step : undefined
      const requires = Array.isArray(data.requires) ? data.requires : undefined
      const produces = Array.isArray(data.produces) ? data.produces : undefined
      const next = typeof data.next === "string" ? data.next : undefined
      const linearStatus = typeof data.linear_status === "string" ? data.linear_status : undefined
      
      const metadata: CommandMetadata = {
        name: commandName,
        description,
        argumentHint,
        model: sanitizeModelField(model, isOpencodeSource ? "opencode" : "claude-code"),
        agent,
        subtask,
        category,
        primary,
        step,
        requires,
        produces,
        next,
        linearStatus,
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
  const userCommandsDir = join(homedir(), ".claude", "commands")
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

interface FormatCommandResult {
  content: string
  preflight: PreflightResult | null
  blocked: boolean
}

async function formatLoadedCommand(cmd: CommandInfo): Promise<FormatCommandResult> {
  const sections: string[] = []
  let preflight: PreflightResult | null = null
  let blocked = false

  if (cmd.metadata.step) {
    preflight = commandPreflight({
      command: cmd.metadata.step,
      requiredArtifacts: cmd.metadata.requires,
      createSpecFolder: cmd.metadata.step === "specify",
    })

    if (preflight.status === "blocked") {
      blocked = true
      sections.push(`# /${cmd.name} Command - BLOCKED\n`)
      sections.push("## Preflight Validation Failed\n")
      sections.push(formatPreflightResult(preflight))
      sections.push("\n---\n")
      sections.push("**Action Required**: Resolve the issues above before proceeding.\n")
      return { content: sections.join("\n"), preflight, blocked }
    }

    sections.push(`# /${cmd.name} Command\n`)
    sections.push("## Preflight Validation\n")
    sections.push(formatPreflightResult(preflight))
    sections.push("\n---\n")
  } else {
    sections.push(`# /${cmd.name} Command\n`)
  }

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

  if (cmd.metadata.step && preflight?.context.specPath) {
    sections.push("\n\n---\n")
    sections.push("## Workflow State (Post-Completion)\n")
    sections.push(`After completing this command, update workflow state:\n`)
    sections.push("```")
    sections.push(`Spec folder: ${preflight.context.specPath}`)
    sections.push(`Current step: ${cmd.metadata.step}`)
    if (cmd.metadata.next) {
      sections.push(`Next step: /${cmd.metadata.next}`)
    }
    if (cmd.metadata.linearStatus) {
      sections.push(`Linear status: ${cmd.metadata.linearStatus}`)
    }
    sections.push("```")
    sections.push("\nThe workflow state will be automatically tracked.")
  }

  return { content: sections.join("\n"), preflight, blocked }
}

const CATEGORY_LABELS: Record<string, { label: string; order: number }> = {
  workflow: { label: "📋 Workflow (Primary)", order: 1 },
  quality: { label: "✅ Quality", order: 2 },
  git: { label: "🔀 Git & PR", order: 3 },
  research: { label: "🔍 Research & Analysis", order: 4 },
  project: { label: "🏗️ Project", order: 5 },
  utils: { label: "🔧 Utilities", order: 6 },
  uncategorized: { label: "📦 Other", order: 99 },
}

function formatCommandList(commands: CommandInfo[]): string {
  if (commands.length === 0) {
    return "No commands found."
  }

  const grouped = new Map<string, CommandInfo[]>()
  
  for (const cmd of commands) {
    const cat = cmd.metadata.category || "uncategorized"
    if (!grouped.has(cat)) {
      grouped.set(cat, [])
    }
    grouped.get(cat)!.push(cmd)
  }

  const sortedCategories = Array.from(grouped.keys()).sort((a, b) => {
    const orderA = CATEGORY_LABELS[a]?.order ?? 50
    const orderB = CATEGORY_LABELS[b]?.order ?? 50
    return orderA - orderB
  })

  const lines = ["# Available Commands\n"]

  for (const cat of sortedCategories) {
    const cmds = grouped.get(cat)!
    const label = CATEGORY_LABELS[cat]?.label || cat
    lines.push(`\n## ${label}\n`)

    const primaryCmds = cmds.filter(c => c.metadata.primary)
    const otherCmds = cmds.filter(c => !c.metadata.primary)
    const sortedCmds = [...primaryCmds, ...otherCmds]

    for (const cmd of sortedCmds) {
      const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
      const primary = cmd.metadata.primary ? " ⭐" : ""
      const next = cmd.metadata.next ? ` → /${cmd.metadata.next}` : ""
      lines.push(
        `- **/${cmd.name}${hint}**${primary}: ${cmd.metadata.description || "(no description)"}${next}`
      )
    }
  }

  lines.push(`\n**Total**: ${commands.length} commands`)
  return lines.join("\n")
}

function formatWorkflowChain(commands: CommandInfo[]): string {
  const workflowCmds = commands
    .filter(c => c.metadata.category === "workflow" && c.metadata.step)
    .sort((a, b) => {
      const stepOrder = ["specify", "plan", "tasks", "implement", "review", "test"]
      const aIdx = stepOrder.indexOf(a.metadata.step || "")
      const bIdx = stepOrder.indexOf(b.metadata.step || "")
      return aIdx - bIdx
    })

  if (workflowCmds.length === 0) {
    return "No workflow commands found."
  }

  const lines = ["# Workflow Chain\n"]
  lines.push("The primary workflow for feature development:\n")
  lines.push("```")
  lines.push(workflowCmds.map(c => `/${c.name}`).join(" → "))
  lines.push("```\n")

  lines.push("## Steps\n")
  for (const cmd of workflowCmds) {
    const requires = cmd.metadata.requires?.length ? `Requires: ${cmd.metadata.requires.join(", ")}` : ""
    const produces = cmd.metadata.produces?.length ? `Produces: ${cmd.metadata.produces.join(", ")}` : ""
    const status = cmd.metadata.linearStatus ? `Linear: ${cmd.metadata.linearStatus}` : ""
    
    lines.push(`### /${cmd.name}`)
    lines.push(`${cmd.metadata.description}\n`)
    if (requires) lines.push(`- ${requires}`)
    if (produces) lines.push(`- ${produces}`)
    if (status) lines.push(`- ${status}`)
    lines.push("")
  }

  lines.push("\n## Quick Start")
  lines.push("```")
  lines.push("/specify <feature description>   # Create spec")
  lines.push("/plan                            # Create plan from spec")
  lines.push("/tasks                           # Create task breakdown")
  lines.push("/implement                       # Implement the feature")
  lines.push("/review                          # Code review")
  lines.push("/test                            # Write and run tests")
  lines.push("```")

  return lines.join("\n")
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  return matrix[b.length][a.length]
}

function findSimilarCommands(cmdName: string, commands: CommandInfo[], maxSuggestions = 3): CommandInfo[] {
  const scored = commands.map(cmd => ({
    cmd,
    distance: levenshteinDistance(cmdName.toLowerCase(), cmd.name.toLowerCase())
  }))
  
  return scored
    .filter(s => s.distance <= Math.max(3, cmdName.length / 2))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(s => s.cmd)
}

export const slashcommand = tool({
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
- ~/.claude/commands/ (user - Claude Code global commands)

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

    const cmdName = args.command.replace(/^\//, "").trim()

    if (cmdName.toLowerCase() === "help workflow" || cmdName.toLowerCase() === "workflow") {
      return formatWorkflowChain(commands)
    }

    const exactMatch = commands.find(
      (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase()
    )

    if (exactMatch) {
      const result = await formatLoadedCommand(exactMatch)
      return result.content
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

    const similarCmds = findSimilarCommands(cmdName, commands)
    if (similarCmds.length > 0) {
      const suggestions = similarCmds.map((cmd) => `/${cmd.name}`).join(", ")
      return (
        `Command "/${cmdName}" not found. Similar commands: ${suggestions}\n\n` +
        formatCommandList(commands)
      )
    }

    return (
      `Command "/${cmdName}" not found.\n\n` +
      formatCommandList(commands) +
      "\n\nTry a different command name or use '/help workflow' to see the workflow chain."
    )
  },
})
