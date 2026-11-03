import { afterEach, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import type { ChildPausePort } from "../pause/ports"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

test("delta-2 LOW: resuming a lost child with the cutoff the run already observed asks the engine once, not twice", async () => {
  const cwd = tempProject()
  const runner = new FakeRunner()
  const calls: string[] = []
  const port: ChildPausePort = {
    pauseForRun: async () => { throw new Error("pause_for_run timed out") },
    observeHold: async () => { calls.push("observe"); return { held: false, childSeq: 0 } },
    resumeTurn: async (_child, request) => {
      calls.push(`resume:${request.childSeqCutoff}`)
      return { turnId: "resumed", outcome: Promise.resolve({ status: "completed", finalResponse: "resumed" }) }
    },
    holdInput: async () => ({ kind: "held", entryId: "held", duplicate: false }),
  }
  const manager = createTaskManager({
    cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(), planner: categoryPlanner(),
    runners: { "in-process": runner, process: runner }, childPausePort: port,
  })
  const started = await manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: started.task_id } }
  try {
    calls.length = 0
    await expect(manager.resumeLostTask(started.task_id, { ...owner, resumeId: "resume-1", childSeqCutoff: 9 }))
      .resolves.toEqual({ turnId: "resumed" })
    expect(calls).toEqual(["resume:9"])
  } finally { await manager.cancelTask(started.task_id) }
})
