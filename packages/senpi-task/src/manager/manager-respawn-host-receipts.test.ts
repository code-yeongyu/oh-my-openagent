import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects } from "./__fixtures__/manager-fakes"
import { reconciliationHarness, stoppedChild } from "./host-reconciliation.test-support"
import { runTaskOutput } from "../tools/output/output"
import { childIdentityOf } from "./manager-helpers"

async function assertRenderedReason(f: Awaited<ReturnType<typeof stoppedChild>>): Promise<void> {
  const record = f.store.load(f.record.task_id)
  const result = await runTaskOutput({ manager: f.manager, stateDir: f.store.stateDir }, { task_id: f.record.task_id }, "parent")
  const rendered = result.content[0]
  if (rendered?.type !== "text" || record?.error_message === undefined) throw new Error("missing reason")
  expect(rendered.text).toContain(record.error_message)
}

afterEach(async () => { await reconciliationHarness.release(); cleanupProjects() })

describe("receipt-driven host respawn lifecycle", () => {
  for (const kind of ["aborted", "interrupted_by_reopen"] as const) {
    test(`${kind} records an interruption, continues once, and tracks the new answer`, async () => {
      const f = await stoppedChild({ state: "done", outcome: { kind } })
      const statuses: string[] = []
      const original = f.store.transition
      // Observe the actual terminal transition, not a postcondition supplied by the fixture.
      f.store.transition = (taskId, transition) => {
        const result = original(taskId, transition)
        if (result.applied) statuses.push(result.record.status)
        return result
      }
      expect(await f.manager.reattach(f.record, f.result.handle)).toEqual({ ok: true })
      expect(f.store.load(f.record.task_id)?.final_response).toBeUndefined()
      expect(f.store.load(f.record.task_id)?.error_message).toBeUndefined()
      f.startContinuation()
      await f.resumed
      expect(statuses).toContain("interrupted")
      expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(2)
      const final = f.manager.waitFor(f.record.task_id, { signal: AbortSignal.timeout(5_000) })
      const session = f.host.sessions()[0]
      if (session === undefined) throw new Error("missing host session")
      f.host.completeTurn(session.routingId, "CONTINUATION ANSWER")
      expect((await final).final_response).toBe("CONTINUATION ANSWER")
      await f.result.handle.dispose()
    })
  }

  test("accepted input becomes idle_queued, not orphaned running work", async () => {
    const f = await stoppedChild({ state: "accepted" })
    await f.manager.reattach(f.record, f.result.handle)
    expect(f.store.load(f.record.task_id)?.status).toBe("interrupted")
    expect(f.events).toContain("idle_queued")
    await assertRenderedReason(f)
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    await f.result.handle.dispose()
  })

  test("deadline sends nothing on reattach and explicit task_send delivers exactly once", async () => {
    const f = await stoppedChild({ state: "done", outcome: { kind: "deadline", deadline: { kind: "max_runtime" } } })
    await f.manager.reattach(f.record, f.result.handle)
    expect(f.store.load(f.record.task_id)?.status).toBe("interrupted")
    expect(f.store.load(f.record.task_id)?.stop_reason).toBe("deadline")
    // The interrupted child now lives behind the respawned handle: its record names that session.
    const respawned = childIdentityOf(f.result.handle).host_session?.routing_id
    expect(respawned).not.toBe(f.record.host_session.routing_id)
    expect(f.store.load(f.record.task_id)?.host_session?.routing_id).toBe(respawned)
    await assertRenderedReason(f)
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    const before = f.host.commands.length
    const sent = await f.manager.sendToTask({ idOrName: f.record.task_id, message: "continue", callerSessionId: "parent" })
    expect(sent.kind).toBe("revived")
    const inputs = f.host.commands.slice(before).filter((command) => ["prompt", "steer", "follow_up"].includes(command.type))
    expect(inputs).toHaveLength(1)
    expect(f.store.load(f.record.task_id)?.stop_reason).toBeUndefined()
    await f.result.handle.dispose()
  })

  test("a failed turn receipt enters the existing child-turn failure path and renders its reason", async () => {
    const f = await stoppedChild({ state: "done", outcome: { kind: "error", reason: "provider_unavailable", detail: "Synthetic provider was unavailable.", action: "Retry the child after the provider recovers." } })
    await f.manager.reattach(f.record, f.result.handle)
    const failed = await f.manager.waitFor(f.record.task_id, { signal: AbortSignal.timeout(5_000) })
    expect(failed.status).toBe("error")
    expect(failed.final_response).toBeUndefined()
    await assertRenderedReason(f)
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    await f.result.handle.dispose()
  })

  test("an explicit resume after a deadline tracks one run when the host emits agent_start", async () => {
    const f = await stoppedChild({ state: "done", outcome: { kind: "deadline", deadline: { kind: "inactivity" } } })
    await f.manager.reattach(f.record, f.result.handle)
    const started = Promise.withResolvers<void>()
    const unsubscribe = f.result.handle.subscribe(event => { if (event.type === "agent_start") started.resolve() })
    await f.manager.sendToTask({ idOrName: f.record.task_id, message: "continue", callerSessionId: "parent" })
    f.startContinuation()
    await started.promise
    const completed = f.manager.waitFor(f.record.task_id, { signal: AbortSignal.timeout(5_000) })
    const session = f.host.sessions()[0]
    if (session === undefined) throw new Error("missing explicitly resumed session")
    f.host.completeTurn(session.routingId, "EXPLICIT ANSWER")
    const result = await completed
    expect(result.final_response).toBe("EXPLICIT ANSWER")
    expect(f.store.load(f.record.task_id)?.notification.run_epoch).toBe(result.notification.run_epoch)
    expect(f.events.filter(type => type === "task_self_resumed")).toEqual([])
    unsubscribe()
    await f.result.handle.dispose()
  })

  test("a deadline stays interrupted when a host wake arrives without task_send", async () => {
    const f = await stoppedChild({ state: "done", outcome: { kind: "deadline", deadline: { kind: "inactivity" } } })
    await f.manager.reattach(f.record, f.result.handle)
    const started = Promise.withResolvers<void>()
    const unsubscribe = f.result.handle.subscribe(event => { if (event.type === "agent_start") started.resolve() })
    f.startContinuation()
    await started.promise
    expect(f.store.load(f.record.task_id)?.status).toBe("interrupted")
    expect(f.store.load(f.record.task_id)?.notification.run_epoch).toBe(0)
    expect(f.events.filter(type => type === "task_self_resumed")).toEqual([])
    unsubscribe()
    await f.result.handle.dispose()
  })
})
