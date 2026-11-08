import type { HandleCallContext, HandleOutcome, HandleRef, HandleSnapshot } from "@code-yeongyu/senpi"
import type { WorkpoolEngine } from "../workpool/engine"
import { WorkpoolError, type WorkpoolCaller, type WorkpoolRecord } from "../workpool/types"
import { EvalHandleHostError } from "./errors"

export type PoolAccess = {
  readonly workpools: Pick<WorkpoolEngine, "inspect" | "cancel" | "subscribe">
  readonly poolCaller: (ownerSessionId: string) => WorkpoolCaller
}

const SETTLED_ITEMS = new Set(["completed", "error", "cancelled"])

// Codemode mints every workpool ref at run_epoch 0: a pool is one run, so it is fenced by owner only.
export function loadOwnedPool(access: PoolAccess, ref: HandleRef, ctx: HandleCallContext): WorkpoolRecord {
  try {
    return access.workpools.inspect(access.poolCaller(ctx.ownerSessionId), ref.id)
  } catch (error) {
    if (error instanceof WorkpoolError && error.code === "scope_denied") {
      throw new EvalHandleHostError("eval_handle_forbidden", `${ref.id} belongs to another session`)
    }
    throw new EvalHandleHostError("eval_handle_not_found", `no workpool ${ref.id}`)
  }
}

export function isPoolSettled(pool: WorkpoolRecord): boolean {
  if (pool.status === "cancelled") return true
  return pool.status === "closing" && pool.items.every((item) => SETTLED_ITEMS.has(item.status))
}

export function poolSnapshot(pool: WorkpoolRecord, ref: HandleRef): HandleSnapshot {
  const settled = isPoolSettled(pool)
  const phase = !settled ? "pending" : pool.status === "cancelled" ? "cancelled" : "succeeded"
  return { ref, phase, host_status: pool.status, revision: settled ? 1 : 0 }
}

export function poolOutcome(pool: WorkpoolRecord, ref: HandleRef): HandleOutcome {
  if (pool.status === "cancelled") {
    return { status: "rejected", ref, error: { code: "eval_handle_cancelled", message: `${ref.id} was cancelled` } }
  }
  const results = pool.items.map((item) => item.status === "completed"
    ? { key: item.key, data: item.data ?? null }
    : { key: item.key, error: item.error ?? { code: item.status, message: "Pool item did not complete." } })
  return { status: "fulfilled", ref, value: results }
}
