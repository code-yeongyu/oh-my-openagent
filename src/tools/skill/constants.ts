export const TOOL_NAME = "skill" as const

export const TOOL_DESCRIPTION_NO_SKILLS = "Load a skill or execute a slash command to get detailed instructions for a specific task. No skills are currently available."

export const TOOL_DESCRIPTION_PREFIX = `Load a skill or execute a slash command to get detailed instructions for a specific task.

Skills and commands provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's or command's description.

**How to use:**
- Call with a skill name: name='code-review'
- Call with a command name (without leading slash): name='publish'
- The tool will return detailed instructions with your context applied.
`
