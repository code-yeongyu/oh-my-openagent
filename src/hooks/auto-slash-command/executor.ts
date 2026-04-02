import { dirname } from "path"
import {
  resolveCommandsInText,
  resolveFileReferencesInText,
} from "../../shared"
import { discoverAllSkills, type LoadedSkill, type LazyContentLoader } from "../../features/opencode-skill-loader"
import { discoverCommandsSync } from "../../tools/slashcommand"
import type { CommandInfo as DiscoveredCommandInfo, CommandMetadata } from "../../tools/slashcommand/types"
import type { ParsedSlashCommand } from "./types"

interface SkillCommandInfo {
  name: string
  path?: string
  metadata: CommandMetadata
  content?: string
  scope: "skill"
  lazyContentLoader?: LazyContentLoader
}

type CommandInfo = DiscoveredCommandInfo | SkillCommandInfo

function skillToCommandInfo(skill: LoadedSkill): SkillCommandInfo {
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
    scope: "skill",
    lazyContentLoader: skill.lazyContent,
  }
}

export interface ExecutorOptions {
  skills?: LoadedSkill[]
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
  agent?: string
  directory?: string
}


async function discoverAllCommands(options?: ExecutorOptions): Promise<CommandInfo[]> {
  const discoveredCommands = discoverCommandsSync(options?.directory ?? process.cwd(), {
    pluginsEnabled: options?.pluginsEnabled,
    enabledPluginsOverride: options?.enabledPluginsOverride,
  })

  const skills = options?.skills ?? await discoverAllSkills()
  const skillCommands = skills.map(skillToCommandInfo)

  const scopeOrder: DiscoveredCommandInfo["scope"][] = ["project", "user", "opencode-project", "opencode", "builtin", "plugin"]
  const grouped = new Map<string, DiscoveredCommandInfo[]>()
  for (const cmd of discoveredCommands) {
    const list = grouped.get(cmd.scope) ?? []
    list.push(cmd)
    grouped.set(cmd.scope, list)
  }
  const orderedCommands = scopeOrder.flatMap((scope) => grouped.get(scope) ?? [])

  return [
    ...skillCommands,
    ...orderedCommands,
  ]
}

async function findCommand(commandName: string, options?: ExecutorOptions): Promise<CommandInfo | null> {
  const allCommands = await discoverAllCommands(options)
  return allCommands.find(
    (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase()
  ) ?? null
}

async function formatCommandTemplate(cmd: CommandInfo, args: string): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${cmd.name} Command\n`)

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`)
  }

  if (args) {
    sections.push(`**User Arguments**: ${args}\n`)
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`)
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`)
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
  const resolvedArguments = args
  const substitutedContent = resolvedContent
    .replace(/\$\{user_message\}/g, resolvedArguments)
    .replace(/\$ARGUMENTS/g, resolvedArguments)
  sections.push(substitutedContent.trim())

  if (args) {
    sections.push("\n\n---\n")
    sections.push("## User Request\n")
    sections.push(args)
  }

  return sections.join("\n")
}

export interface ExecuteResult {
  success: boolean
  replacementText?: string
  error?: string
}

export async function executeSlashCommand(parsed: ParsedSlashCommand, options?: ExecutorOptions): Promise<ExecuteResult> {
  const command = await findCommand(parsed.command, options)

  if (!command) {
    return {
      success: false,
      error: `Command "/${parsed.command}" not found. Use the skill tool to list available skills and commands.`,
    }
  }

  if (command.scope === "skill" && command.metadata.agent) {
    if (!options?.agent || command.metadata.agent !== options.agent) {
      return {
        success: false,
        error: `Skill "${command.name}" is restricted to agent "${command.metadata.agent}"`,
      }
    }
  }

  try {
    const template = await formatCommandTemplate(command, parsed.args)
    return {
      success: true,
      replacementText: template,
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to load command "/${parsed.command}": ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
