import { afterEach, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import type { ChildPausePort } from "../pause/ports"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// A child engine with one hold sequence: its own Stop raises it, and a parent Resume releases
// only when its frozen cutoff covers every hold the child has seen.
function childEngine(runner: FakeRunner) {
  let childSeq = 8
  let turns = 0
  const port: ChildPausePort = {
    pauseForRun: async child => {
      runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
      return { childSeq }
    },
    resumeTurn: async (_child, request) => {
      if (request.childSeqCutoff < childSeq) return { otherHoldLive: true, childSeq }
      turns += 1
      return { turnId: `turn-${turns}`, outcome: Promise.resolve({ status: "completed", finalResponse: "resumed" }) }
    },
    holdInput: async () => ({ kind: "held", entryId: "held", duplicate: false }),
  }
  return { port, childStop: () => { childSeq += 1 }, turns: () => turns }
}

async function pausedChild(order: "child Stop before the parent's acknowledgement" | "child Stop after the parent's request") {
  const cwd = tempProject()
  const runner = new FakeRunner()
  const child = childEngine(runner)
  const manager = createTaskManager({
    cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(), planner: categoryPlanner(),
    runners: { "in-process": runner, process: runner }, childPausePort: child.port,
  })
  const started = await manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 1, runRef: { kind: "task" as const, id: started.task_id } }
  if (order === "child Stop before the parent's acknowledgement") child.childStop()
  const ack = await manager.pauseTask(started.task_id, owner)
  if ("refused" in ack) throw new Error("expected the parent to own the child")
  if (order === "child Stop after the parent's request") child.childStop()
  return { manager, child, taskId: started.task_id, owner, cutoff: ack.childSeq }
}

test("design 41: a child Stop acknowledged before the parent's request is covered by the cutoff, so one turn resumes both holds", async () => {
  const h = await pausedChild("child Stop before the parent's acknowledgement")
  expect(h.cutoff).toBe(9)
  const terminal = h.manager.waitFor(h.taskId)
  expect(await h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: h.cutoff })).toEqual({ turnId: "turn-1" })
  expect(await terminal).toMatchObject({ status: "completed", final_response: "resumed" })
  expect(h.child.turns()).toBe(1)
})

test("design 41: a child Stop after the parent's request outlives the Resume, leaving the child paused with no turn", async () => {
  const h = await pausedChild("child Stop after the parent's request")
  expect(h.cutoff).toBe(8)
  expect(await h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: h.cutoff }))
    .toEqual({ otherHoldLive: true, childSeq: 9 })
  expect(h.manager.get(h.taskId)?.status).toBe("paused")
  expect(h.manager.concurrency?.leaseState(h.taskId, 0)).toBe("parked")
  expect(h.child.turns()).toBe(0)
  await h.manager.cancelTask(h.taskId)
})
