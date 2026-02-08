import { z } from "zod"

export const TEAM_COLOR_PALETTE = [
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
  "red",
] as const

export const TeamTaskStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"])
export type TeamTaskStatus = z.infer<typeof TeamTaskStatusSchema>

export const TeamLeadMemberSchema = z.object({
  agentId: z.string(),
  name: z.literal("team-lead"),
  agentType: z.literal("team-lead"),
  model: z.string(),
  joinedAt: z.number(),
  cwd: z.string(),
  subscriptions: z.array(z.unknown()).default([]),
}).strict()

export const TeamTeammateMemberSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  agentType: z.string().refine((value) => value !== "team-lead", {
    message: "agent_type_reserved",
  }),
  category: z.string(),
  model: z.string(),
  prompt: z.string(),
  color: z.string(),
  planModeRequired: z.boolean().default(false),
  joinedAt: z.number(),
  cwd: z.string(),
  subscriptions: z.array(z.unknown()).default([]),
  backendType: z.literal("native").default("native"),
  isActive: z.boolean().default(false),
  sessionID: z.string().optional(),
  backgroundTaskID: z.string().optional(),
}).strict()

export const TeamMemberSchema = z.union([TeamLeadMemberSchema, TeamTeammateMemberSchema])

export const TeamConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  createdAt: z.number(),
  leadAgentId: z.string(),
  leadSessionId: z.string(),
  members: z.array(TeamMemberSchema),
}).strict()

export const TeamInboxMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  timestamp: z.string(),
  read: z.boolean().default(false),
  summary: z.string().optional(),
  color: z.string().optional(),
}).strict()

export const TeamTaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  status: TeamTaskStatusSchema,
  blocks: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const TeamSendMessageTypeSchema = z.enum([
  "message",
  "broadcast",
  "shutdown_request",
  "shutdown_response",
  "plan_approval_response",
])

export type TeamLeadMember = z.infer<typeof TeamLeadMemberSchema>
export type TeamTeammateMember = z.infer<typeof TeamTeammateMemberSchema>
export type TeamMember = z.infer<typeof TeamMemberSchema>
export type TeamConfig = z.infer<typeof TeamConfigSchema>
export type TeamInboxMessage = z.infer<typeof TeamInboxMessageSchema>
export type TeamTask = z.infer<typeof TeamTaskSchema>
export type TeamSendMessageType = z.infer<typeof TeamSendMessageTypeSchema>

export const TeamCreateInputSchema = z.object({
  team_name: z.string(),
  description: z.string().optional(),
})

export const TeamDeleteInputSchema = z.object({
  team_name: z.string(),
})

export const TeamReadConfigInputSchema = z.object({
  team_name: z.string(),
})

export const TeamSpawnInputSchema = z.object({
  team_name: z.string(),
  name: z.string(),
  prompt: z.string(),
  category: z.string(),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  plan_mode_required: z.boolean().optional(),
})

function normalizeTeamRecipient(recipient: string): string {
  const trimmed = recipient.trim()
  const atIndex = trimmed.indexOf("@")
  if (atIndex <= 0) {
    return trimmed
  }

  return trimmed.slice(0, atIndex)
}

export const TeamSendMessageInputSchema = z.object({
  team_name: z.string(),
  type: TeamSendMessageTypeSchema,
  recipient: z.string().optional().transform((value) => {
    if (value === undefined) {
      return undefined
    }

    return normalizeTeamRecipient(value)
  }),
  content: z.string().optional(),
  summary: z.string().optional(),
  request_id: z.string().optional(),
  approve: z.boolean().optional(),
  sender: z.string().optional(),
})

export const TeamReadInboxInputSchema = z.object({
  team_name: z.string(),
  agent_name: z.string(),
  unread_only: z.boolean().optional(),
  mark_as_read: z.boolean().optional(),
})

export const TeamTaskCreateInputSchema = z.object({
  team_name: z.string(),
  subject: z.string(),
  description: z.string(),
  active_form: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const TeamTaskUpdateInputSchema = z.object({
  team_name: z.string(),
  task_id: z.string(),
  status: TeamTaskStatusSchema.optional(),
  owner: z.string().optional(),
  subject: z.string().optional(),
  description: z.string().optional(),
  active_form: z.string().optional(),
  add_blocks: z.array(z.string()).optional(),
  add_blocked_by: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const TeamTaskListInputSchema = z.object({
  team_name: z.string(),
})

export const TeamTaskGetInputSchema = z.object({
  team_name: z.string(),
  task_id: z.string(),
})

export const TeamForceKillInputSchema = z.object({
  team_name: z.string(),
  agent_name: z.string(),
})

export const TeamProcessShutdownInputSchema = z.object({
  team_name: z.string(),
  agent_name: z.string(),
})

export interface TeamToolContext {
  sessionID: string
  messageID: string
  agent?: string
}

export function isTeammateMember(member: TeamMember): member is TeamTeammateMember {
  return member.agentType !== "team-lead"
}
