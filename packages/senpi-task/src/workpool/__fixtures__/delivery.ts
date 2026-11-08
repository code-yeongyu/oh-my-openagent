import { expect } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { KernelToolBindingRegistry } from "../../kernel-tools/bindings"
import type { KernelToolGrant } from "../../kernel-tools/resolve"
import type { ManagedStartSpec } from "../../manager/types"
import type { PendingSteeringEntry } from "../../state"
import { fixture, fixtureHandle, poolInput, bounded, deferred } from "./admission"
import type { WorkpoolEvent, WorkpoolYield } from "../types"

export { bounded, deferred }
export const signal = () => AbortSignal.timeout(5000)
export function deliveryFixture(options: {
  readonly mode?: "fresh" | "keep_alive"
  readonly agent?: string
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // Creates the pool WITH parent kernel tools, exactly as the workpool tool does for a live cell.
  readonly kernelTools?: { readonly names: readonly string[]; readonly grant: KernelToolGrant }
} = {}) {
  const turns: { spec: ManagedStartSpec; pending: readonly PendingSteeringEntry[] }[] = []
  const children = new Map<string, ReturnType<typeof fixtureHandle>>()
  const resumes: ManagedStartSpec[] = []
  let onFollowUp: (message: string, taskId: string) => Promise<void> = async () => undefined
  const f = fixture({ ...(options.kernelToolBindings === undefined ? {} : { kernelToolBindings: options.kernelToolBindings }), runner: {
    start: async spec => {
      const child = fixtureHandle(spec.taskId)
      children.set(spec.taskId, child)
      turns.push({ spec, pending: f.store.load(spec.taskId)?.pending_steering ?? [] })
      const directory = join(f.store.stateDir, "children", spec.taskId, "sessions", spec.taskId)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, "fixture.jsonl"), JSON.stringify({ type: "session", id: `session-${spec.taskId}` }) + "\n")
      return child.handle
    },
    resume: async spec => {
      resumes.push(spec)
      const child = fixtureHandle(spec.taskId)
      children.set(spec.taskId, child)
      return { ...child.handle, followUp: async message => { child.followUps.push(message); await onFollowUp(message, spec.taskId) } }
    },
  } })
  const pool = f.manager.workpools.create(f.caller, { ...poolInput, mode: options.mode ?? "keep_alive",
    ...(options.agent === undefined ? {} : { agent: { subagent_type: options.agent, prompt: "Process assigned input" } }),
    ...(options.kernelTools === undefined ? {} : { tools: [...options.kernelTools.names] }),
  }, options.kernelTools?.grant)
  const push = (key: string, input: number = 1) => f.manager.workpools.push(f.caller, pool.pool_id, [{ key, input }])
  const event = (kind: WorkpoolEvent["kind"]) => f.manager.workpools.waitForEvent(pool.pool_id, kind, signal())
  const inspect = () => f.manager.workpools.inspect(f.caller, pool.pool_id)
  const yieldResults = (id: string, epoch: number, results: readonly WorkpoolYield[]): unknown => f.manager.workpools.yieldResults(id, epoch, { op: "yield", results })
  async function start(key = "first") {
    const dispatched = event("dispatched")
    push(key)
    const result = await dispatched
    if (result.task_id === undefined || result.run_epoch === undefined) throw new Error("Missing worker identity")
    return { taskId: result.task_id, epoch: result.run_epoch }
  }
  async function settle(taskId: string) {
    const idle = event("worker_idle")
    const child = children.get(taskId)
    if (child === undefined) throw new Error("Missing child")
    child.settle({ status: "completed", finalResponse: "misleading success: all items complete" })
    return idle
  }
  async function park(taskId: string) {
    f.store.mutate(taskId, record => ({ ...record, updated_at: "2000-01-01T00:00:00.000Z" }))
    await f.lifecycle.reclaimIdleResidents?.()
    expect(f.store.load(taskId)?.residency_state).toBe("persisted_only")
  }
  return { ...f, pool, turns, children, resumes, push, event, inspect, start, settle, park, yieldResults,
    followUp: (callback: typeof onFollowUp) => { onFollowUp = callback },
  }
}
