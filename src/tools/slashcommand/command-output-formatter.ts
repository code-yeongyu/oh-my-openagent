import { dirname } from "path"
import { resolveCommandsInText, resolveFileReferencesInText } from "../../shared"
import type { CommandInfo } from "./types"

export async function formatLoadedCommand(
  command: CommandInfo,
  userMessage?: string
): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${command.name} Command\n`)

  if (command.metadata.description) {
    sections.push(`**Description**: ${command.metadata.description}\n`)
  }

  if (command.metadata.argumentHint) {
    sections.push(`**Usage**: /${command.name} ${command.metadata.argumentHint}\n`)
  }

  if (userMessage) {
    sections.push(`**Arguments**: ${userMessage}\n`)
  }

  if (command.metadata.model) {
    sections.push(`**Model**: ${command.metadata.model}\n`)
  }

  if (command.metadata.agent) {
    sections.push(`**Agent**: ${command.metadata.agent}\n`)
  }

  if (command.metadata.subtask) {
    sections.push("**Subtask**: true\n")
  }

  sections.push(`**Scope**: ${command.scope}\n`)
  sections.push("---\n")
  sections.push("## Command Instructions\n")

  let content = command.content || ""
  if (!content && command.lazyContentLoader) {
    content = await command.lazyContentLoader.load()
  }

  const commandDir = command.path ? dirname(command.path) : process.cwd()
  const withFileReferences = await resolveFileReferencesInText(content, commandDir)
  const resolvedContent = await resolveCommandsInText(withFileReferences)

  let finalContent = resolvedContent.trim()
  if (userMessage) {
    finalContent = finalContent.replace(/\$\{user_message\}/g, userMessage)
  }

  sections.push(finalContent)
  return sections.join("\n")
}

export function formatCommandList(items: CommandInfo[]): string {
  if (items.length === 0) return "No commands or skills found."

  const lines = ["# Available Commands & Skills\n"]

  for (const command of items) {
    const hint = command.metadata.argumentHint ? ` ${command.metadata.argumentHint}` : ""
    lines.push(
      `- **/${command.name}${hint}**: ${command.metadata.description || "(no description)"} (${command.scope})`
    )
  }

  lines.push(`\n**Total**: ${items.length} items`)
  return lines.join("\n")
}
