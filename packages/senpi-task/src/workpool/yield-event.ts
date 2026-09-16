import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { messageSha256 } from "../steering/engine-policy"
import type { TaskRecordStore } from "../store"
import { canonicalJson, WorkpoolYieldSchema } from "./schema"
import type { WorkpoolYield } from "./types"
import type { WorkerTurn } from "./worker-turn"

export const WorkpoolYieldEventSchema = z.object({
  type: z.literal("workpool_yield"), payload: z.object({
    pool_id: z.string(), generation: z.number().int().positive(), task_id: z.string(), run_epoch: z.number().int().nonnegative(),
    item_id: z.string(), result: WorkpoolYieldSchema.shape.results.element, sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})
export function yieldDigest(result: WorkpoolYield): string {
  return messageSha256(canonicalJson(result.error === undefined ? { key: result.key, data: result.data } : { key: result.key, error: result.error }))
}
export function readYieldEvents(tasks: TaskRecordStore, turn: WorkerTurn): readonly z.output<typeof WorkpoolYieldEventSchema>["payload"][] {
  let bytes: string
  try { bytes = readFileSync(join(tasks.stateDir, "logs", `${turn.task_id}.jsonl`), "utf8") }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
  const events: z.output<typeof WorkpoolYieldEventSchema>["payload"][] = []
  const lines = bytes.split("\n")
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue
    let raw: unknown
    try { raw = JSON.parse(line) }
    catch (error) { if (error instanceof SyntaxError && index === lines.length - 1) break; throw error }
    const parsed = WorkpoolYieldEventSchema.safeParse(raw)
    if (!parsed.success) continue
    const event = parsed.data.payload
    if (event.pool_id === turn.pool_id && event.task_id === turn.task_id && event.run_epoch === turn.run_epoch && event.generation === turn.generation) events.push(event)
  }
  return events
}
