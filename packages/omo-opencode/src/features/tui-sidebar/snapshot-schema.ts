import { z } from "zod"

import { MIRROR_SCHEMA_VERSION } from "./constants"
import type { AgentStatus, LoopLive } from "./state-types"
import type { BackgroundTaskStatus } from "../background-agent/types"

const AGENT_STATUS_VALUES = [
  "busy",
  "idle",
  "error",
  "running",
  "retry",
] as const satisfies readonly AgentStatus[]

const BACKGROUND_TASK_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "error",
  "cancelled",
  "interrupt",
] as const satisfies readonly BackgroundTaskStatus[]

const AgentRowSchema = z.object({
  name: z.string(),
  status: z.enum(AGENT_STATUS_VALUES),
})

const JobRowSchema = z.object({
  title: z.string(),
  status: z.enum(BACKGROUND_TASK_STATUS_VALUES),
  toolCalls: z.number().int().nonnegative().nullable(),
  lastTool: z.string().nullable(),
})

const LoopLiveSchema = z.object({
  kind: z.literal("live"),
  goalsDone: z.number().int().nonnegative(),
  goalsTotal: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  activeGoal: z.string().nullable(),
}) satisfies z.ZodType<LoopLive>

export const TuiRuntimeSnapshotSchema = z.object({
  version: z.literal(MIRROR_SCHEMA_VERSION),
  projectDir: z.string(),
  updatedAt: z.number(),
  activeAgents: z.array(AgentRowSchema),
  jobBoard: z.array(JobRowSchema),
  loop: LoopLiveSchema.nullable(),
})

export type TuiRuntimeSnapshot = z.infer<typeof TuiRuntimeSnapshotSchema>

export function parseSnapshot(raw: unknown): TuiRuntimeSnapshot | null {
  const parsed = TuiRuntimeSnapshotSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  return parsed.data
}
