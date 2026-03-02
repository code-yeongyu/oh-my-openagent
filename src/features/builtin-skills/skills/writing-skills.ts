import type { BuiltinSkill } from "../types"

export const WRITING_SKILLS_NAME = "writing-skills"
export const WRITING_SKILLS_DESCRIPTION =
	"Teaches agents how to write high-quality skills for oh-my-opencode. Covers frontmatter fields, description quality, body structure, security rules, scope selection, and how to use skill_manage to create/edit skills. Triggers: 'write a skill', 'create a skill', 'improve this skill', 'skill authoring'."

export const writingSkillsSkill: BuiltinSkill = {
	name: WRITING_SKILLS_NAME,
	description: WRITING_SKILLS_DESCRIPTION,
	template: `# Writing Skills — Meta-Skill for Skill Authoring

You are a skill author. Your job is to create or improve SKILL.md files that agents load
via the \`skill\` tool. High-quality skills are precise, self-contained, and triggerable.

---

## TOOL: skill_manage

Always use \`skill_manage\` to create, edit, or delete skills — never write files directly.

\`\`\`
skill_manage({ operation: "create", scope: "project"|"user", name: "...", content: "..." })
skill_manage({ operation: "edit",   scope: "project"|"user", name: "...", content: "..." })
skill_manage({ operation: "delete", scope: "project"|"user", name: "..." })
skill_manage({ operation: "list" })
skill_manage({ operation: "read",   scope: "project"|"user", name: "..." })
\`\`\`

Scope rules:
- \`project\` → \`.opencode/skills/<name>/SKILL.md\` — checked into the repo, team-visible
- \`user\`    → \`~/.config/opencode/skills/<name>/SKILL.md\` — personal, all projects

---

## SKILL.md STRUCTURE

\`\`\`markdown
---
name: kebab-case-name
description: "One sentence. Precise trigger phrases. No vague words."
---

# Skill Title

Body content here.
\`\`\`

### Required frontmatter fields

| Field         | Required | Notes |
|---------------|----------|-------|
| \`name\`        | yes      | kebab-case, matches directory name |
| \`description\` | yes      | Critical — shown in /skill search, drives trigger matching |

### Optional frontmatter fields

| Field           | Notes |
|-----------------|-------|
| \`model\`         | Override model: \`claude-opus-4-5\`, \`claude-sonnet-4-5\`, etc. |
| \`agent\`         | Sub-agent mode: \`"subagent"\` |
| \`subtask\`       | Mark as subtask: \`true\` |
| \`argument-hint\` | Shown in /skill autocomplete hint |
| \`allowed-tools\` | Comma-separated tool whitelist |

---

## DESCRIPTION QUALITY (MOST IMPORTANT FIELD)

The description is what agents see in \`/skill [query]\` search and what the \`skill\` tool
exposes in its \`available_skills\` list. A bad description = skill never gets used.

### Rules

1. **Start with what it does**, not what it is
2. **Include trigger phrases** — exact words a user or agent would say
3. **Be specific** — "git commit atomic splits" beats "git helper"
4. **Under 200 chars** — gets truncated in UI

### Examples

\`\`\`
BAD:  "A skill for working with git"
GOOD: "Atomic git commits, rebase/squash, history search (blame, bisect, log -S). Triggers: 'commit', 'rebase', 'squash', 'who wrote', 'when was X added'."

BAD:  "Helps with frontend development"
GOOD: "Designer-turned-developer who crafts stunning UI/UX even without design mockups. Triggers: 'build UI', 'style component', 'design layout', 'tailwind'."
\`\`\`

---

## BODY STRUCTURE

A skill body should contain:

1. **Role declaration** — one sentence, what the agent IS in this skill
2. **Trigger detection** — table mapping user phrases → modes/actions
3. **Workflow** — numbered phases or steps, concrete and actionable
4. **Rules / constraints** — hard rules the agent must follow
5. **Examples** (optional) — for complex patterns

Keep body under 150 lines. Skills are injected into context — every line costs tokens.

### Anti-patterns to avoid

- Vague instructions ("be helpful", "use best practices")
- Duplicate content from system prompt
- Long prose — use tables and bullets
- No trigger detection — agent won't know when to use it

---

## SECURITY RULES

skill_manage will REJECT content that contains:

| Pattern | Reason |
|---------|--------|
| PEM/private keys | Secret leakage |
| AWS/GCP/Azure credentials | Secret leakage |
| \`ghp_\` / \`sk-\` tokens | API key leakage |
| High-entropy strings (>4 consecutive) | Likely secret |

skill_manage will WARN (but allow) on:
- \`eval\` / \`exec\` calls
- subprocess spawning
- Shell expansions (\`\$()\`, backticks)
- External URLs in scripts

---

## WORKFLOW

### Creating a new skill

1. Ask: what task does this skill handle?
2. Draft the description (trigger phrases first)
3. Choose scope: project (team) or user (personal)
4. Write the body: role → trigger detection → workflow → rules
5. Call \`skill_manage({ operation: "create", ... })\`
6. Verify with \`/skill <name>\` in the TUI or \`skill_manage({ operation: "read", ... })\`

### Improving an existing skill

1. Read it first: \`skill_manage({ operation: "read", ... })\`
2. Identify: vague description? missing triggers? bloated body?
3. Edit: \`skill_manage({ operation: "edit", ... })\`
4. Re-read to confirm

### Reviewing a skill for quality

Checklist:
- [ ] Description has trigger phrases
- [ ] Description is under 200 chars
- [ ] Body has a role declaration
- [ ] Body has trigger detection (table or explicit list)
- [ ] Body is under 150 lines
- [ ] No secrets or high-entropy strings
- [ ] Frontmatter \`name\` matches the directory name

$ARGUMENTS
`,
}
