import type { HandleCallContext, HandleRef, HandleSnapshot, HandleWatch } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"
import { fenceRun, type TaskRecord } from "../state"
import { WATCH_HOST_STATUS } from "./control"
import { EvalHandleHostError } from "./errors"
import { loadOwnedPool, poolSnapshot, type PoolAccess } from "./pool-refs"
import { loadFencedTask, taskSnapshot, type TaskReader } from "./task-refs"
import { createUpdateQueue } from "./update-queue"

export type TaskWaiter = TaskReader & {
  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord>
}

export type WatchDeps = { readonly tasks: TaskWaiter; readonly pools: PoolAccess }

/**
 * Each ref is subscribed BEFORE its initial snapshot is read, and an update is pushed only when its
 * revision is newer than the ref's last one: a settle that lands during setup is seen exactly once,
 * in `initial` or as one update, never both and never lost. Nothing polls.
 */
export async function watchRefs(deps: WatchDeps, refs: readonly HandleRef[], ctx: HandleCallContext): Promise<HandleWatch> {
  const queue = createUpdateQueue()
  const controller = new AbortController()
  const unsubscribes: (() => void)[] = []
  const latest = new Map<HandleRef, number>()
  const close = (): void => {
    ctx.signal?.removeEventListener("abort", close)
    controller.abort()
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
    queue.end()
  }
  const offer = (ref: HandleRef, snapshot: HandleSnapshot): void => {
    const known = latest.get(ref)
    if (known !== undefined && snapshot.revision <= known) return
    latest.set(ref, snapshot.revision)
    queue.push(snapshot)
  }
  ctx.signal?.addEventListener("abort", close, { once: true })
  try {
    const initial = refs.map((ref) => {
      const snapshot = ref.kind === "workpool" ? subscribePool(deps.pools, ref, ctx, unsubscribes, offer) : subscribeTask(deps.tasks, ref, ctx, controller.signal, offer)
      latest.set(ref, snapshot.revision)
      return snapshot
    })
    return { initial, updates: queue.updates, close }
  } catch (error) {
    close()
    throw error
  }
}

function subscribeTask(tasks: TaskWaiter, ref: HandleRef, ctx: HandleCallContext, signal: AbortSignal, offer: (ref: HandleRef, snapshot: HandleSnapshot) => void): HandleSnapshot {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `${ref.kind} refs are not served by the task host`)
  // The waiter settles with the terminal record, or rejects once the watch closes (abort).
  tasks.waitFor(ref.id, { signal }).then(
    // A pre-upgrade record cannot prove an in-run epoch move, but its terminal still ends the watch: the caller's
    // result() then names the re-fetch, instead of wait() hanging until its timeout.
    (record) => {
      const fence = fenceRun(record, ref.run_epoch)
      if (fence === "live" || fence === "legacy") offer(ref, taskSnapshot(record, ref))
      // The run this ref named is gone (rolled back, or replaced): end the watch now so wait() reads the reason from
      // result() instead of waiting out its timeout.
      // Revision: this ref's own terminal slot (epoch * 2 + 1), so a later run on a reused epoch still counts as newer.
      else offer(ref, { ref, phase: "lost", host_status: WATCH_HOST_STATUS.runGone, revision: ref.run_epoch * 2 + 1 })
    },
    () => undefined,
  )
  return taskSnapshot(loadFencedTask(tasks, ref, ctx), ref)
}

function subscribePool(pools: PoolAccess, ref: HandleRef, ctx: HandleCallContext, unsubscribes: (() => void)[], offer: (ref: HandleRef, snapshot: HandleSnapshot) => void): HandleSnapshot {
  unsubscribes.push(pools.workpools.subscribe((event) => {
    if (event.pool_id !== ref.id) return
    try {
      offer(ref, poolSnapshot(loadOwnedPool(pools, ref, ctx), ref))
    } catch (error) {
      log("senpi-task eval-handle pool watch could not re-read its pool", { poolId: ref.id, error: error instanceof Error ? error.message : String(error) })
    }
  }))
  return poolSnapshot(loadOwnedPool(pools, ref, ctx), ref)
}
