import type { BuiltinSkill } from "../types"

export const teamModeSkill: BuiltinSkill = {
  name: "team-mode",
  description:
    "Team orchestration — create and manage parallel agent teams (OFF by default; enable via team_mode.enabled in config). Loading this skill provides usage documentation; the team_* tools are registered globally when team_mode.enabled=true and access-gated by team role.",
  template: `# Team Mode

Team mode gives Claude Code Agent Teams parity. It is off by default. Enable it only when you want parallel multi-agent coordination, where each team member is an opencode child session.

## When to use

- Split a large job across several agents.
- Keep a lead agent focused while member agents work in parallel.
- Use worktree mode for isolated code changes, or tmux visualization when you want live session layout.

## Declare a team

Create a team at \`~/.omo/teams/{name}/config.json\`.

You can also pass the same object directly to \`team_create({ inline_spec: ... })\`.

This TeamSpec uses a lead plus members list. Every canonical member has a \`kind\` discriminator.

Example:

\`\`\`json
{
  "name": "release-squad",
  "lead": {
    "kind": "subagent_type",
    "subagent_type": "sisyphus"
  },
  "members": [
    {
      "kind": "category",
      "category": "quick",
      "prompt": "review small changes and report risks"
    },
    {
      "kind": "subagent_type",
      "subagent_type": "atlas"
    }
  ]
}
\`\`\`

Inline shorthand is accepted for category members. If \`kind\` is omitted, \`category\` implies \`kind: "category"\`. If a member uses natural planning fields like \`role\`, \`description\`, \`capabilities\`, or an unknown \`kind\`, it becomes a category worker using the current config's first enabled category. If \`kind\` is an unknown string such as a category name, that string is used as the category. \`systemPrompt\` is accepted as a \`prompt\` alias, and \`loadSkills\` is ignored because team members receive their behavior through \`prompt\`.

Example:

\`\`\`json
{
  "name": "project-analysis-team",
  "members": [
    {
      "name": "structure-analyst",
      "category": "quick",
      "systemPrompt": "Analyze directory layouts, module boundaries, and architectural organization."
    },
    {
      "name": "quality-analyst",
      "category": "quick",
      "systemPrompt": "Analyze tests, CI/CD, build scripts, conventions, and anti-patterns."
    },
    {
      "name": "Agent 3: Quality/Process Analyst",
      "role": "Quality/Process Analyst",
      "capabilities": ["tests", "builds", "CI/CD"]
    }
  ]
}
\`\`\`

## Member schema

Use \`kind: "category"\` when you want a category-backed worker. It must include both \`category\` and \`prompt\`. D-40: category members always route through \`sisyphus-junior\`.

Use \`kind: "subagent_type"\` only for eligible agents.

### Eligible subagent types

- \`sisyphus\`
- \`atlas\`
- \`sisyphus-junior\`
- \`hephaestus\`

### Hard rejects

Do not use \`oracle\`, \`prometheus\`, or other non-eligible agents here. For those, use \`delegate-task\` instead.

## Lifecycle

1. Lead creates the team with \`team_create({ teamName: "existing-team" })\` or \`team_create({ inline_spec: { name: "team-name", members: [...] } })\`. Never call \`team_create\` with empty arguments.
2. Lead assigns work with \`team_send_message\` or \`team_task_create\`.
3. Members report progress with \`team_send_message\` plus \`team_task_update\`.
4. Lead and members track progress with \`team_task_list\`, \`team_task_get\`, and \`team_status\`.
5. Lead requests shutdown with \`team_shutdown_request\` when the team is ready to wind down.
6. The targeted member or the lead handles \`team_approve_shutdown\` or \`team_reject_shutdown\`.
7. Lead removes the team with \`team_delete\`.

## Lead-only tools

- \`team_create\` - create a team from a declaration.
- \`team_delete\` - remove a team.
- \`team_shutdown_request\` - start the shutdown flow.

## Lead or target-member shutdown tools

- \`team_approve_shutdown\` - approve shutdown for the targeted member.
- \`team_reject_shutdown\` - reject shutdown for the targeted member.

## Universal team-run tools

- \`team_send_message\` - send a direct message; broadcast is still lead-only.
- \`team_task_create\` - create a task for a member.
- \`team_task_list\` - list team tasks.
- \`team_task_update\` - update task state.
- \`team_task_get\` - inspect one task.
- \`team_status\` - show live team status.

## Global query tool

- \`team_list\` - list known teams.

## Bounds

- Max 8 members.
- Max 4 parallel workers.
- Max 32KB per message.
- Max 256KB unread inbox.

## Failure modes

- Broadcast is lead-only.
- No nested teams.
- No peer sync wait; work moves asynchronously.

## Notes

Team mode is a docs-only skill. The team_* tools are registered globally when \`team_mode.enabled=true\`.
Use \`~/.omo/teams/{name}/config.json\` plus worktree or tmux visibility to understand how the team is laid out.
`,
}
