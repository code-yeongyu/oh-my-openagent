import type { BuiltinSkill } from "../types"

export const fallbackBrowserSkill: BuiltinSkill = {
  name: "browser-automation",
  description:
    "Browser automation setup for a custom provider. Load when browser tasks are needed but no built-in browser skill is available.",
  template: `# Browser Automation — Custom Provider Setup

The configured browser automation provider is **{provider}**. No built-in skill exists for this provider.

## What You Need to Do
Tell the user:

> "The browser automation provider **{provider}** requires a skill file to work.
> Create a SKILL.md at \`~/.claude/skills/{provider}/SKILL.md\` with API documentation
> for this browser automation tool. Restart OpenCode after creating the file."

## How the User Creates the Skill
The skill file format is standard Claude Code SKILL.md with YAML frontmatter:

\`\`\`markdown
---
name: {provider}
description: [purpose]
---
# {provider} API Reference
[API usage examples, installation steps, configuration options]
\`\`\`

Once the user creates the skill and restarts, it will load automatically.

## Important
DO NOT silently fall back to Playwright or any other browser tool.
If browser automation is needed but no skill exists, explain the situation clearly.`,
}
