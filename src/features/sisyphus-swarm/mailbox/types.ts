import { z } from "zod"

export const MailboxMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  timestamp: z.string(),
  color: z.string().optional(),
  read: z.boolean(),
})

export type MailboxMessage = z.infer<typeof MailboxMessageSchema>

export const PermissionRequestSchema = z.object({
  type: z.literal("permission_request"),
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  agentId: z.string(),
  timestamp: z.number(),
})

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>

export const PermissionResponseSchema = z.object({
  type: z.literal("permission_response"),
  requestId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  updatedInput: z.unknown().optional(),
  feedback: z.string().optional(),
  permissionUpdates: z.unknown().optional(),
})

export type PermissionResponse = z.infer<typeof PermissionResponseSchema>

export const ShutdownRequestSchema = z.object({
  type: z.literal("shutdown_request"),
})

export type ShutdownRequest = z.infer<typeof ShutdownRequestSchema>

export const ShutdownApprovedSchema = z.object({
  type: z.literal("shutdown_approved"),
})

export type ShutdownApproved = z.infer<typeof ShutdownApprovedSchema>

export const ShutdownRejectedSchema = z.object({
  type: z.literal("shutdown_rejected"),
  reason: z.string().optional(),
})

export type ShutdownRejected = z.infer<typeof ShutdownRejectedSchema>

export const TaskAssignmentSchema = z.object({
  type: z.literal("task_assignment"),
  taskId: z.string(),
  subject: z.string(),
  description: z.string(),
  assignedBy: z.string(),
  timestamp: z.number(),
})

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>

export const TaskCompletedSchema = z.object({
  type: z.literal("task_completed"),
  taskId: z.string(),
  agentId: z.string(),
  timestamp: z.number(),
})

export type TaskCompleted = z.infer<typeof TaskCompletedSchema>

export const IdleNotificationSchema = z.object({
  type: z.literal("idle_notification"),
})

export type IdleNotification = z.infer<typeof IdleNotificationSchema>

export const JoinRequestSchema = z.object({
  type: z.literal("join_request"),
  agentName: z.string(),
  sessionId: z.string(),
})

export type JoinRequest = z.infer<typeof JoinRequestSchema>

export const JoinApprovedSchema = z.object({
  type: z.literal("join_approved"),
  agentName: z.string(),
  teamName: z.string(),
})

export type JoinApproved = z.infer<typeof JoinApprovedSchema>

export const JoinRejectedSchema = z.object({
  type: z.literal("join_rejected"),
  reason: z.string().optional(),
})

export type JoinRejected = z.infer<typeof JoinRejectedSchema>

export const PlanApprovalRequestSchema = z.object({
  type: z.literal("plan_approval_request"),
  requestId: z.string(),
  plan: z.string(),
  agentId: z.string(),
})

export type PlanApprovalRequest = z.infer<typeof PlanApprovalRequestSchema>

export const PlanApprovalResponseSchema = z.object({
  type: z.literal("plan_approval_response"),
  requestId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().optional(),
})

export type PlanApprovalResponse = z.infer<typeof PlanApprovalResponseSchema>

export const ModeSetRequestSchema = z.object({
  type: z.literal("mode_set_request"),
  mode: z.enum(["acceptEdits", "bypassPermissions", "default", "delegate", "dontAsk", "plan"]),
})

export type ModeSetRequest = z.infer<typeof ModeSetRequestSchema>

export const TeamPermissionUpdateSchema = z.object({
  type: z.literal("team_permission_update"),
  permissions: z.record(z.string(), z.unknown()),
})

export type TeamPermissionUpdate = z.infer<typeof TeamPermissionUpdateSchema>

export const ProtocolMessageSchema = z.discriminatedUnion("type", [
  PermissionRequestSchema,
  PermissionResponseSchema,
  ShutdownRequestSchema,
  ShutdownApprovedSchema,
  ShutdownRejectedSchema,
  TaskAssignmentSchema,
  TaskCompletedSchema,
  IdleNotificationSchema,
  JoinRequestSchema,
  JoinApprovedSchema,
  JoinRejectedSchema,
  PlanApprovalRequestSchema,
  PlanApprovalResponseSchema,
  ModeSetRequestSchema,
  TeamPermissionUpdateSchema,
])

export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>
