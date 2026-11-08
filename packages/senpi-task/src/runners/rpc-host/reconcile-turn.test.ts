import { appendFileSync, writeFileSync } from "node:fs"
import * as fsPromises from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { cleanupProjects, makeManager, tempProject } from "../../manager/__fixtures__/manager-fakes"
import { adaptRpcHandle } from "../../manager/child-handle"
import { createTaskRecord } from "../../state"
import { runTaskOutput } from "../../tools/output/output"
import type { RunnerOutcome } from "../in-process/child-handle"
import { isHostSessionHandle } from "../rpc-host"
import { childSpec, hostRunnerHarness } from "../rpc-host.test-support"
import { HOST_RESPAWN_CONTINUATION, reconcileHostTurn, type InputEffectStatus, type ReconciledTurnNotice } from "./reconcile-turn"
import { reattachContinuationPrompt } from "./reattach"

const harness = hostRunnerHarness()
afterEach(async () => { await harness.release(); cleanupProjects() })

function scenario(options: {
  readonly streaming?: boolean
  readonly receipt?: InputEffectStatus
  readonly aborted?: boolean
  readonly deadline?: boolean
  readonly error?: boolean
} = {}) {
  const path = join(tempProject(), "session.jsonl")
  writeFileSync(path, [
    { type: "message", id: "user-1", message: { role: "user", content: "work" } },
    { type: "message", id: "answer-1", message: { role: "assistant", stopReason: options.error ? "error" : options.aborted ? "aborted" : "stop", errorMessage: "fixture_stream_error", content: [{ type: "text", text: "ANSWER" }] } },
    ...(options.deadline ? [{ type: "agent_end", aborted: true, abortSource: "system", deadline: { kind: "inactivity" } }] : []),
  ].map((row) => JSON.stringify(row)).join("\n"))
  const outcomes: RunnerOutcome[] = []
  const notices: ReconciledTurnNotice[] = []
  const port = {
    getState: async () => ({ sessionId: "session", isStreaming: options.streaming === true }),
    ...(options.receipt === undefined ? {} : { lastInputEffect: options.receipt }),
    settle: (outcome: RunnerOutcome) => { outcomes.push(outcome) },
    notify: (notice: ReconciledTurnNotice) => { notices.push(notice) },
  }
  return { path, port, outcomes, notices }
}

describe("host turn reconciliation authority", () => {
  for (const prompt of [reattachContinuationPrompt(), HOST_RESPAWN_CONTINUATION]) {
    test(`idle unanswered ${prompt === HOST_RESPAWN_CONTINUATION ? "respawn" : "reattach"} continuation interrupts instead of empty success, even with an applied receipt`, async () => {
      const f = scenario({ receipt: { state: "applied" } })
      appendFileSync(f.path, `\n${JSON.stringify({
        type: "message", message: { role: "user", content: [{ type: "text", text: prompt }] },
      })}\n`)
      expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("interrupted")
      expect(f.outcomes).toEqual([{ status: "cancelled" }])
      expect(f.notices).toEqual([{
        kind: "interrupted",
        reason: expect.any(String),
        action: expect.stringContaining("task_send"),
      }])
    })
  }

  test("host dies after a delivered continuation before child output and leaves an actionable interrupted task", async () => {
    const recovering = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const reopen = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let recovery = 0
    const host = await harness.fakeHost({ transcripts: true })
    const runner = harness.runnerOver(host, {
      reattachDelaysMs: [0],
      sleep: () => {
        const index = recovery++
        recovering[index]?.resolve()
        return reopen[index]?.promise ?? Promise.reject(new Error("unexpected third recovery"))
      },
    })
    const project = tempProject()
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
    try {
      // The first host dies during the original turn. Reopening delivers one continuation.
      const delivered = host.waitForCommand("prompt")
      await host.restart()
      await recovering[0]!.promise
      reopen[0]!.resolve()
      const continuation = await delivered
      expect(continuation.payload.message).toBe(reattachContinuationPrompt())
      await handle.getEntries()
      expect(store.load(record.task_id)?.status).toBe("running")

      // The next host dies after that delivery, with no assistant message ever written.
      const outcome = handle.waitForOutcome()
      await host.restart()
      await recovering[1]!.promise
      reopen[1]!.resolve()
      await handle.getEntries()
      expect(await outcome).toEqual({ status: "cancelled" })
      const stopped = store.load(record.task_id)
      expect(stopped?.status).toBe("interrupted")
      expect(stopped?.final_response).toBeUndefined()
      expect(stopped?.error_message).toContain("continuation")
      expect(stopped?.error_message).toContain("task_send")
      const output = await runTaskOutput({ manager, stateDir: store.stateDir }, { task_id: record.task_id }, "parent")
      const rendered = output.content[0]
      if (rendered?.type !== "text" || stopped?.error_message === undefined) throw new Error("missing interruption output")
      expect(rendered.text).toContain(stopped.error_message)
      expect(host.commands.filter(command => command.type === "prompt")).toHaveLength(2)
    } finally {
      for (const gate of reopen) gate.resolve()
      await handle.dispose()
    }
  }, 5_000)

  test("streaming execution outranks a completed receipt and final transcript", async () => {
    const f = scenario({ streaming: true, receipt: { state: "done", outcome: { kind: "completed" } } })
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("streaming")
    expect(f.outcomes).toEqual([])
    expect(f.notices).toEqual([])
  })

  test("idle completed tail adopts once by entry identity", async () => {
    const f = scenario()
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("adopted")
    const record = { final_response: "ANSWER", host_session: { socket: "", routing_id: "", session_path: f.path, instance_id: "", adopted_entry_id: "answer-1" } }
    expect(await reconcileHostTurn(f.port, record, f.path)).toBe("adopted")
    expect(f.outcomes).toEqual([{ status: "completed", finalResponse: "ANSWER" }])
    expect(f.notices).toEqual([{ kind: "adopted", entryId: "answer-1" }])
  })

  for (const kind of ["aborted", "interrupted_by_reopen"] as const) {
    test(`idle ${kind} receipt rejects partial text and requests one continuation`, async () => {
      const f = scenario({ receipt: { state: "done", outcome: { kind } } })
      expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("continued")
      expect(f.outcomes).toEqual([])
      expect(f.notices[0]?.kind).toBe("interrupted")
    })
  }

  test("accepted receipt identifies idle queued work without adopting old text", async () => {
    const f = scenario({ receipt: { state: "accepted" } })
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("idle_queued")
    expect(f.notices[0]?.kind).toBe("idle_queued")
    expect(f.outcomes).toEqual([{ status: "cancelled" }])
  })

  test("accepted receipt outranks an older deadline in the transcript", async () => {
    const f = scenario({ receipt: { state: "accepted" }, deadline: true })
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("idle_queued")
    expect(f.notices[0]?.kind).toBe("idle_queued")
  })
  test("stale applied receipt falls back to the completed transcript", async () => {
    const f = scenario({ receipt: { state: "applied" } })
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("adopted")
    expect(f.outcomes).toEqual([{ status: "completed", finalResponse: "ANSWER" }])
  })

  test("an adoption marker without a persisted terminal still settles the recovered handle", async () => {
    const f = scenario()
    appendFileSync(f.path, `\n${JSON.stringify({ type: "custom", customType: "rpc_client_message_admission", data: { state: "completed" } })}\n`)
    const record = { host_session: { socket: "", routing_id: "", session_path: f.path, instance_id: "", adopted_entry_id: "answer-1" } }
    expect(await reconcileHostTurn(f.port, record, f.path)).toBe("adopted")
    expect(f.notices).toEqual([])
    expect(f.outcomes).toEqual([{ status: "completed", finalResponse: "ANSWER" }])
  })

  test("a pre-S1 failed transcript settles as a turn failure instead of adopting partial text", async () => {
    const f = scenario({ error: true })
    expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("failed")
    expect(f.outcomes[0]).toMatchObject({ status: "error", failure: { kind: "child-turn-failed" } })
    expect(f.notices).toEqual([])
  })

  test("the adopted answer and entry identity come from one transcript snapshot", async () => {
    const f = scenario()
    const originalOpen = fsPromises.open
    let reads = 0
    const opened = spyOn(fsPromises, "open").mockImplementation((...args: Parameters<typeof fsPromises.open>) => {
      if (args[0] === f.path && ++reads === 2) appendFileSync(f.path, `\n${JSON.stringify({
        type: "message", id: "answer-2", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "LATER ANSWER" }] },
      })}\n`)
      return originalOpen(...args)
    })
    try {
      expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("adopted")
      expect(f.notices).toEqual([{ kind: "adopted", entryId: "answer-1" }])
      expect(f.outcomes).toEqual([{ status: "completed", finalResponse: "ANSWER" }])
    } finally {
      opened.mockRestore()
    }
  })
  for (const receipt of [undefined, { state: "done", outcome: { kind: "deadline", deadline: { kind: "inactivity" } } } satisfies InputEffectStatus]) {
    test(`deadline ${receipt === undefined ? "transcript" : "receipt"} stops without adopting partial text`, async () => {
      const f = scenario({ receipt, aborted: true, deadline: true })
      expect(await reconcileHostTurn(f.port, {}, f.path)).toBe("stopped_deadline")
      expect(f.outcomes).toEqual([{ status: "cancelled" }])
      expect(f.notices).toEqual([{
        kind: "interrupted",
        reason: expect.any(String),
        deadline: { kind: "inactivity" },
      }])
    })
  }
})
