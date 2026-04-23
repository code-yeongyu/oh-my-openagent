import { z } from "zod"

export const MESSAGE_KINDS = [
  "message",
  "shutdown_request",
  "shutdown_approved",
  "shutdown_rejected",
  "announcement",
] as const

export const MEMBER_KINDS = ["category", "subagent_type"] as const

export const TASK_STATUSES = ["pending", "claimed", "in_progress", "completed", "deleted"] as const

export const RUNTIME_STATUSES = [
  "creating",
  "active",
  "shutdown_requested",
  "deleting",
  "deleted",
  "failed",
  "orphaned",
] as const

const MemberBaseSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  cwd: z.string().optional(),
  worktreePath: z.string().optional(),
  subscriptions: z.array(z.string()).optional(),
  backendType: z.enum(["in-process", "tmux"]).default("in-process"),
  color: z.string().optional(),
  isActive: z.boolean().default(true),
}).strict()

export const CategoryMemberSchema = MemberBaseSchema.extend({
  kind: z.literal("category"),
  category: z.string().min(1),
  prompt: z.string().min(1),
})

export const SubagentMemberSchema = MemberBaseSchema.extend({
  kind: z.literal("subagent_type"),
  subagent_type: z.string().min(1),
  prompt: z.string().optional(),
})

export const MemberSchema = z.discriminatedUnion("kind", [CategoryMemberSchema, SubagentMemberSchema])

const TeamReferenceSchema = z.object({
  path: z.string(),
  description: z.string().optional(),
}).strict()

export const TeamSpecSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  createdAt: z.number().int().positive(),
  leadAgentId: z.string(),
  teamAllowedPaths: z.array(z.string()).optional(),
  sessionPermission: z.string().optional(),
  members: z.array(MemberSchema).min(1).max(8),
})

export const MessageSchema = z.object({
  version: z.literal(1),
  messageId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().max(32 * 1024),
  summary: z.string().optional(),
  references: z.array(TeamReferenceSchema).optional(),
  timestamp: z.number().int().positive(),
  correlationId: z.string().uuid().optional(),
  color: z.string().optional(),
})

export const TaskSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  status: z.enum(TASK_STATUSES),
  owner: z.string().optional(),
  blocks: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  claimedAt: z.number().int().positive().optional(),
})

const RuntimeStateMemberSchema = z.object({
  name: z.string(),
  sessionId: z.string().optional(),
  tmuxPaneId: z.string().optional(),
  agentType: z.enum(["leader", "general-purpose"]),
  status: z.enum(["pending", "running", "idle", "errored", "completed", "shutdown_approved"]),
  color: z.string().optional(),
  worktreePath: z.string().optional(),
  lastInjectedTurnMarker: z.string().optional(),
  pendingInjectedMessageIds: z.array(z.string()).default([]),
}).strict()

const RuntimeBoundsSchema = z.object({
  maxMembers: z.number().int().default(8),
  maxParallelMembers: z.number().int().default(4),
  maxMessagesPerRun: z.number().int().default(10000),
  maxWallClockMinutes: z.number().int().default(120),
  maxMemberTurns: z.number().int().default(500),
}).strict()

const ShutdownRequestSchema = z.object({
  memberId: z.string(),
  requestedAt: z.number().int().positive(),
  approvedAt: z.number().int().positive().optional(),
  rejectedReason: z.string().optional(),
}).strict()

export const RuntimeStateSchema = z.object({
  version: z.literal(1),
  teamRunId: z.string().uuid(),
  teamName: z.string(),
  specSource: z.enum(["project", "user"]),
  createdAt: z.number().int().positive(),
  status: z.enum(RUNTIME_STATUSES),
  leadSessionId: z.string().optional(),
  members: z.array(RuntimeStateMemberSchema),
  shutdownRequests: z.array(ShutdownRequestSchema).default([]),
  bounds: RuntimeBoundsSchema,
})

export const AGENT_ELIGIBILITY_REGISTRY: Readonly<Record<string, {
  verdict: "eligible" | "conditional" | "hard-reject"
  rejectionMessage?: string
}>> = {
  morpheus: { verdict: "eligible" },
  keymaker: { verdict: "eligible" },
  architect: { verdict: "eligible" },
  cipher: { verdict: "eligible" },
  oracle: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'oracle' is read-only (strategic planner). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead.",
  },
  merovingian: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'merovingian' is read-only (consultation/debugging). Cannot write to mailbox as team member. Use delegate-task for consultation queries instead.",
  },
  operator: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'operator' is read-only (docs/GitHub search). Cannot write to mailbox as team member. Use delegate-task for documentation queries instead.",
  },
  trinity: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'trinity' is read-only (codebase grep). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead.",
  },
  seraph: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'seraph' is read-only (pre-planning analysis). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead.",
  },
  smith: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'smith' is read-only (plan validator). Cannot write to mailbox as team member. Use delegate-task for plan validation instead.",
  },
  niobe: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'niobe' is read-only (research specialist). Cannot write to mailbox as team member. Use delegate-task for research queries instead.",
  },
  sentinel: {
    verdict: "hard-reject",
    rejectionMessage:
      "Agent 'sentinel' is read-only (security auditor). Cannot write to mailbox as team member. Use delegate-task for security analysis instead.",
  },
} as const

export type TeamSpec = z.infer<typeof TeamSpecSchema>
export type Member = z.infer<typeof MemberSchema>
export type CategoryMember = z.infer<typeof CategoryMemberSchema>
export type SubagentMember = z.infer<typeof SubagentMemberSchema>
export type Message = z.infer<typeof MessageSchema>
export type Task = z.infer<typeof TaskSchema>
export type RuntimeState = z.infer<typeof RuntimeStateSchema>
