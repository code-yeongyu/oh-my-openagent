import type { CommandInfo } from "./types"

export const TOOL_DESCRIPTION_PREFIX = `Load a skill or execute a command to get detailed instructions for a specific task.

Skills and commands provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's or command's description.

**How to use:**
- Call with command name only: command='publish'
- Call with command and arguments: command='publish' user_message='patch'
- The tool will return detailed instructions for the command with your arguments substituted.
`

export function buildDescriptionFromItems(items: CommandInfo[]): string {
  const commandListForDescription = items
    .map((command) => {
      const hint = command.metadata.argumentHint ? ` ${command.metadata.argumentHint}` : ""
      return `- /${command.name}${hint}: ${command.metadata.description} (${command.scope})`
    })
    .join("\n")

  return `${TOOL_DESCRIPTION_PREFIX}
<available_skills>
${commandListForDescription}
</available_skills>`
}
