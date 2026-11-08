import { z } from "zod"
import { WorkpoolError, type PoolId, type Json } from "./types"

export const nonempty = z.string().trim().min(1)
export const WorkpoolAgentSchema = z.union([
  z.strictObject({ category: nonempty, prompt: nonempty, model: nonempty.optional() }),
  z.strictObject({ subagent_type: nonempty, prompt: nonempty, model: nonempty.optional() }),
])
export const WorkpoolCreateSchema = z.strictObject({
  name: nonempty, agent: WorkpoolAgentSchema, mode: z.enum(["fresh", "keep_alive"]).optional(), tools: z.array(nonempty).optional(),
})
export const WorkpoolItemsSchema = z.array(z.strictObject({ key: nonempty, input: z.json() }))
export const WorkpoolYieldSchema = z.strictObject({ op: z.literal("yield"), results: z.array(z.union([
  z.strictObject({ key: nonempty, data: z.json() }),
  z.strictObject({ key: nonempty, error: z.strictObject({ code: nonempty, message: nonempty }) }),
])) })
const poolId = z.string().regex(/^wp_[0-9a-f]{32}$/)
export const WorkpoolCommandSchema = z.discriminatedUnion("op", [
  WorkpoolCreateSchema.extend({ op: z.literal("create") }),
  z.strictObject({ op: z.literal("push"), pool_id: poolId, items: WorkpoolItemsSchema }),
  z.strictObject({ op: z.literal("close"), pool_id: poolId }),
  z.strictObject({ op: z.literal("inspect"), pool_id: poolId }),
  z.strictObject({ op: z.literal("cancel"), pool_id: poolId }),
  WorkpoolYieldSchema,
])
export type WorkpoolCommand = z.infer<typeof WorkpoolCommandSchema>

export function parsePoolId(value: string): PoolId {
  if (!isPoolId(value)) throw new WorkpoolError("invalid_pool_id", "Expected a wp_ pool identifier.")
  return value
}
function isPoolId(value: string): value is PoolId { return /^wp_[0-9a-f]{32}$/.test(value) }

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
}

export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new WorkpoolError("invalid_input", "Invalid workpool arguments.")
  return result.data
}
