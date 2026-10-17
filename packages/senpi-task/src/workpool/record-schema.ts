import { z } from "zod"
import { WorkpoolAgentSchema, nonempty } from "./schema"
import type { WorkpoolRecord } from "./types"

const model = z.strictObject({
  provider: nonempty, model_id: nonempty, display: nonempty, source: z.enum(["category", "explicit", "agent"]),
  variant: z.string().optional(), reasoning: z.string().optional(), reasoning_effort: z.string().optional(),
})
const plan = z.strictObject({
  model: nonempty, requested_model: model.optional(), resolved_model: model.optional(), fallback_models: z.array(model).optional(),
  variant: z.string().optional(), agentExecutionMode: z.enum(["in-process", "process"]).optional(),
  agentType: z.string().optional(), category: z.string().optional(), instructions: z.string().optional(),
  toolAllowlist: z.array(z.string()).optional(), toolDenylist: z.array(z.string()).optional(),
  promptAppend: z.string().optional(), allowedSubagents: z.array(z.string()).optional(), maxDepth: z.number().int().nonnegative().optional(),
})
const epoch = z.number().int().nonnegative()
const taskId = z.string().regex(/^st_[0-9a-f]{8}$/)
export const WorkpoolRecordSchema = z.strictObject({
  version: z.literal(1), pool_id: z.templateLiteral(["wp_", z.string()]).refine(id => /^wp_[0-9a-f]{32}$/.test(id)),
  name: nonempty, parent_session_id: nonempty, root_session_id: nonempty,
  generation: z.number().int().positive(), revision: epoch, mode: z.enum(["fresh", "keep_alive"]), agent: WorkpoolAgentSchema,
  worker_spec: z.strictObject({
    plan,
    start: z.strictObject({
      prompt: nonempty, parent_session_id: nonempty, root_session_id: nonempty, depth: epoch, cwd: nonempty,
      category: nonempty.optional(), subagent_type: nonempty.optional(), model: nonempty.optional(),
      execution_mode: z.enum(["in-process", "process"]), allowed_subagents: z.array(nonempty).optional(),
    }),
  }),
  status: z.enum(["open", "closing", "cancelled"]),
  // Plain-data worker tool names only; no closure, descriptor or generation is ever persisted.
  kernel_tool_names: z.array(nonempty).optional(),
  aggregate: z.strictObject({ generation: z.number().int().positive(), delivered: z.boolean(), accepted: z.boolean().optional() }).optional(),
  items: z.array(z.strictObject({
    key: nonempty, input: z.json(), item_id: z.templateLiteral(["wi_", z.string()]).refine(id => /^wi_[0-9a-f]{32}$/.test(id)),
    status: z.enum(["queued", "assigned", "completed", "error", "cancelled"]),
    binding: z.strictObject({ task_id: taskId, run_epoch: epoch, generation: z.number().int().positive() }).optional(),
    delivery: z.strictObject({ phase: z.enum(["queued", "dispatching", "acknowledged"]), message_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).optional(),
    data: z.json().optional(), error: z.strictObject({ code: nonempty, message: z.string() }).optional(),
    yield_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })),
  workers: z.array(z.strictObject({
    task_id: taskId, run_epoch: epoch, status: z.enum(["busy", "idle"]), completed_turns: epoch, idle_since: z.number().nonnegative(),
  })),
}) satisfies z.ZodType<WorkpoolRecord>
