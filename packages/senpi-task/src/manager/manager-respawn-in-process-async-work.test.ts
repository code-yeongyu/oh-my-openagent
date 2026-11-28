import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../runners/async-work.test-support"
import { InProcessRunner, type ChildSession } from "../runners/in-process"
import type { RunnerOutcome } from "../runners/in-process/child-handle"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskRecord } from "../state"
import { cleanupProjects, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"
import { createInProcessManagedRunner } from "./runner"

afterEach(cleanupProjects)

/** The engine's durable lifecycle record for one `waitingOn` (customType session-lifecycle). */
function lifecycleRow(waits: unknown): Record<string, unknown> {
  return {
    type: "custom",
    customType: "session-lifecycle",
    data: { ...lifecycleSnapshot(waits), sessionId: "restored-child" },
  }
}

/** A session file whose last answer is `answer`, with the engine's lifecycle records before and after it. */
function transcript(dir: string, answer: string, after: readonly unknown[], before: readonly unknown[] = []): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "2026-11-26_child.jsonl")
  const rows = [
    { type: "session", id: "restored-child", timestamp: "2026-11-26T00:00:00.000Z", cwd: dir },
    { type: "message", id: "u1", message: { role: "user", content: "run the delayed eval" } },
    ...before.map(lifecycleRow),
    {
      type: "message",
      id: "a1",
      message: { role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop" },
    },
    ...after.map(lifecycleRow),
  ]
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`)
  return path
}

/** The restored engine session: its transcript's last assistant text is the answer on file. */
function restoredSession(answer: string): ChildSession {
  return {
    sessionId: "restored-child",
    prompt: () => Promise.resolve(),
    steer: () => Promise.resolve("handled"),
    followUp: () => Promise.resolve("handled"),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    getLastAssistantText: () => answer,
    dispose: () => {},
  }
}

/** A fresh parent restores a nonterminal in-process record through the real InProcessRunner.resume. */
async function restore(
  answer: string,
  after: readonly unknown[],
  before: readonly unknown[] = [],
): Promise<RunnerOutcome> {
  const project = tempProject()
  const record = {
    ...createTaskRecord(
      {
        parent_session_id: "parent",
        root_session_id: "parent",
        depth: 1,
        execution_mode: "in-process",
        model: "anthropic/claude-sonnet-4-5",
        notify_on_terminal: false,
      },
      0,
    ),
    status: "running" as const,
  }
  const withSpec = { ...record, spawn_spec: { version: 1 as const, cwd: project, prompt: "run the delayed eval" } }
  const sessionDir = resolveChildSessionDir(join(project, "children", record.task_id), record.task_id)
  const sessionPath = transcript(sessionDir, answer, after, before)
  const runner = new InProcessRunner({ createSession: async () => restoredSession(answer) })
  const result = await respawnManagedTask({
    beforeLaunch: () => undefined,
    record: withSpec,
    sessionPath,
    stateDir: project,
    runners: {
      "in-process": createInProcessManagedRunner(runner),
      process: { start: () => Promise.reject(new Error("unused")) },
    },
    rpcRunner: { start: () => Promise.reject(new Error("unused")) },
  })
  if (!result.ok) throw new Error(result.reason)
  try {
    return await result.handle.waitForOutcome()
  } finally {
    await result.handle.dispose()
  }
}

/**
 * Delta review 2 HIGH 1 on #15137 (omo#10487): a fresh parent restores an in-process child from its
 * transcript. A last answer the engine recorded as given while the child's own work was still pending
 * is the held note of a turn whose work died with the old process, never the result; a genuinely
 * finished answer stays the result.
 */
describe("respawn restores an in-process child whose last answer waited on its own work (omo#10487)", () => {
  test("#given a transcript whose last answer was held on a pending cell #when a fresh parent restores it #then its outcome is async_work_pending, never completed", async () => {
    // given / when
    const outcome = await restore(PROGRESS_NOTE, [DETACHED_CELL_WAITS])

    // then
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
  })

  test("#given a transcript whose last answer left no work pending #when a fresh parent restores it #then that answer is the outcome", async () => {
    // given / when
    const outcome = await restore(FINAL_RESULT, [undefined])

    // then
    expect(outcome).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
  })

  test("#given the cell was recorded pending after the note and then drained (a later zero record) #when a fresh parent restores it #then the positive record still makes it async_work_pending", async () => {
    // given / when - the engine appends a new record whenever waitingOn changes, so the drain follows
    const outcome = await restore(PROGRESS_NOTE, [DETACHED_CELL_WAITS, undefined])

    // then
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
  })

  test("#given work that started and drained before the answer #when a fresh parent restores it #then that answer is the outcome", async () => {
    // given / when - only records before the answer named the work; after it, nothing was pending
    const outcome = await restore(FINAL_RESULT, [undefined], [DETACHED_CELL_WAITS, undefined])

    // then
    expect(outcome).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
  })
})
