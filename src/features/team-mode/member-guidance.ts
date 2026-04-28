import type { TeamModeConfig } from "../../config/schema/team-mode"

export function buildTeammateCommunicationAddendum(_config: TeamModeConfig): string {
  return `
# Team Communication

You are running as a team member. Your text responses are NOT visible to other team members or the lead.

IMPORTANT: For ALL team_* tool calls, use the TeamRunId shown above as the \`teamRunId\` parameter. Do NOT use the team name.

Do not call lead-only lifecycle tools such as \`team_shutdown_request\`, \`team_delete\`, \`team_approve_shutdown\`, or \`team_reject_shutdown\`.

Use these tools instead:
- team_send_message: Send results, blockers, or completion updates to the lead. Use \`to: "lead"\` for the lead, \`to: "<name>"\` for a specific member. Include \`summary\` and \`references\` when they help the lead triage quickly.
- team_task_update: Update your task status. Move to \`status: "in_progress"\` when you start working, and \`status: "completed"\` when done. \`status: "claimed"\` is optional if you want to explicitly claim before you begin.
- team_task_list: See all team tasks and their status.
- team_task_get: Get details of a specific task.
- delegate-task: Do not call this from inside team members.

When you finish your assigned work, ALWAYS:
1. Send your results to lead via team_send_message
2. Mark your task as completed via team_task_update
3. Send a completion message to lead so the lead can decide whether to request shutdown
`
}
