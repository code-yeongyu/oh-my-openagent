import { afterEach, describe, expect, test } from "bun:test"
import { childSpec, hostRunnerHarness } from "../rpc-host.test-support"
import { isHostSessionHandle } from "../rpc-host"
import { cleanupProjects, makeManager, tempProject } from "../../manager/__fixtures__/manager-fakes"
import { adaptRpcHandle } from "../../manager/child-handle"
import { createTaskRecord } from "../../state"

const harness = hostRunnerHarness()
afterEach(async () => { await harness.release(); cleanupProjects() })

describe("host recovery adopts a turn finished during the transport gap", () => {
  for (const rejectState of [false, true]) {
    test(`${rejectState ? "a rejected get_state" : "streaming state"} outranks a finished tail and keeps the recovered child tracked without input`, async () => {
      const recovering = Promise.withResolvers<void>()
      const reopen = Promise.withResolvers<void>()
      const reattached: string[] = []
      const project = tempProject()
      const host = await harness.fakeHost({ transcripts: true })
      const runner = harness.runnerOver(host, {
        reattachDelaysMs: [0],
        sleep: () => { recovering.resolve(); return reopen.promise },
        shardEvents: { onReattachOutcome: info => reattached.push(info.outcome) },
      })
      const initial = createTaskRecord({
        parent_session_id: "parent", root_session_id: "parent", depth: 1,
        execution_mode: "process", model: "anthropic/claude-sonnet-4-5", notify_on_terminal: false,
      }, 0)
      const handle = await runner.start(childSpec({ state_dir: project, task_id: initial.task_id }))
      if (!isHostSessionHandle(handle)) throw new Error("expected host session")
      const { manager, store } = makeManager({ project })
      const record = { ...initial, status: "running" as const, host_pid: process.pid }
      store.save(record)
      expect(await manager.reattach(record, adaptRpcHandle(handle))).toEqual({ ok: true })
      const before = host.commands.length
      try {
        host.cutConnections()
        await recovering.promise
        host.completeTurn(handle.hostSession.routingId, "OLDER FINISHED ANSWER")
        host.emitRecord(handle.hostSession.routingId, { type: "agent_start" })
        if (rejectState) host.failReply("get_state", "Synthetic state read unavailable")
        reopen.resolve()
        await handle.getEntries()

        expect(reattached).toEqual(["attached"])
        expect(handle.attached).toBe(true)
        expect(handle.hasExited()).toBe(false)
        expect(handle.wasAbortedByUser()).toBe(false)
        expect(store.load(record.task_id)?.status).toBe("running")
        expect(store.load(record.task_id)?.final_response).toBeUndefined()
        expect(host.commands.slice(before).filter(command =>
          ["prompt", "steer", "follow_up", "abort", "close_session", "detach_session"].includes(command.type),
        )).toEqual([])

        // A later outcome must still reach the manager, proving its tracker remains armed.
        host.failReply("get_state", undefined)
        const finished = manager.waitFor(record.task_id, { signal: AbortSignal.timeout(5_000) })
        host.completeTurn(handle.hostSession.routingId, "LIVE TURN ANSWER")
        expect((await finished).final_response).toBe("LIVE TURN ANSWER")
      } finally {
        reopen.resolve()
        await handle.dispose()
      }
    }, 5_000)
  }

  test("a session the host reopened from its file is continued even when get_state fails", async () => {
    const recovering = Promise.withResolvers<void>()
    const reopen = Promise.withResolvers<void>()
    const reattached: string[] = []
    const outcome = Promise.withResolvers<string>()
    const host = await harness.fakeHost({ transcripts: true })
    const runner = harness.runnerOver(host, {
      reattachDelaysMs: [0],
      sleep: () => { recovering.resolve(); return reopen.promise },
      shardEvents: { onReattachOutcome: info => { reattached.push(info.outcome); outcome.resolve(info.outcome) } },
    })
    const handle = await runner.start(childSpec({ state_dir: tempProject() }))
    if (!isHostSessionHandle(handle)) throw new Error("expected host session")
    try {
      host.cutConnections()
      await recovering.promise
      // A restarted host has no live session: the reattach reopens the transcript (attached: false).
      await host.restart()
      // The reopen's own post-open get_state succeeds; only the reconciliation's read after it fails.
      const pinCheck = host.waitForCommand("get_state")
      void pinCheck.then(() => host.failReply("get_state", "Synthetic state read unavailable"))
      const continuation = host.waitForCommand("prompt")
      reopen.resolve()

      const delivered = await continuation
      const reported = await outcome.promise

      expect(typeof delivered.payload.message).toBe("string")
      expect(reported).toBe("continued")
      expect(reattached).toEqual(["continued"])
      expect(handle.hasExited()).toBe(false)
    } finally {
      reopen.resolve()
      host.failReply("get_state", undefined)
      await handle.dispose()
    }
  }, 5_000)

  test("the real host runner completes with the transcript answer and one prompt total", async () => {
    // Subscribe to the reattach attempt; the gate makes the transport gap deterministic.
    const recovering = Promise.withResolvers<void>()
    const reopen = Promise.withResolvers<void>()
    const host = await harness.fakeHost({ transcripts: true })
    const runner = harness.runnerOver(host, {
      reattachDelaysMs: [0],
      sleep: () => { recovering.resolve(); return reopen.promise },
    })
    const handle = await runner.start(childSpec({ state_dir: tempProject() }))
    if (!isHostSessionHandle(handle)) throw new Error("expected host session")
    const outcome = handle.waitForOutcome()
    host.cutConnections()
    await recovering.promise
    host.completeTurn(handle.hostSession.routingId, "REAL FINAL ANSWER")
    reopen.resolve()
    expect(await outcome).toEqual({ status: "completed", finalResponse: "REAL FINAL ANSWER" })
    expect(handle.lastAssistantText()).toBe("REAL FINAL ANSWER")
    expect(host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    await handle.dispose()
  })
})
