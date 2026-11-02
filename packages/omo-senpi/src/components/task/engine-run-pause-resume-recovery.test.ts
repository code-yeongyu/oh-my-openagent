import { afterEach, expect, test } from "bun:test"
import { cleanupProjects, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { ResumeTaskResult } from "../../../../senpi-task/src/manager/run-pause"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { createEngineRunPause } from "./engine-run-pause"

afterEach(cleanupProjects)

const PARENT = "parent"
const nodeB: PauseParticipant = {
  key: "st_b", kind: "dag_node", taskId: "st_b", nodeId: "b", runEpoch: 0,
  runRef: { kind: "dag", id: "run-1" }, state: "held", ackSeq: 7, observedChildSeq: 8, at: "2026-01-01T00:00:00.000Z",
}

type ChildState = { readonly status: "running" | "paused"; readonly runPause?: true }

function graphOver(child: ChildState, answer: () => ResumeTaskResult) {
  const resumeCalls: string[] = []
  const record = {
    task_id: "st_b", status: child.status, notification: { run_epoch: 0 },
    ...(child.runPause === true ? { run_pause: { parent_session_id: PARENT, parent_pause_seq: 7, run_ref: nodeB.runRef } } : {}),
  }
  const manager = {
    list: () => [],
    get: (taskId: string) => taskId === "st_b" ? record : undefined,
    resumePausedTask: async (taskId: string) => {
      resumeCalls.push(taskId)
      if (record.status !== "paused") throw new Error(`cannot resume ${record.status} task`)
      return answer()
    },
  } as unknown as Parameters<typeof createEngineRunPause>[0]["manager"]
  const graph = createEngineRunPause({
    stateDir: tempProject(), barrier: new AdmissionBarrier(), manager,
    runtime: { getPauseState: () => undefined, fenceRun: () => undefined },
  })
  graph.registry.begin(PARENT, 7, [nodeB])
  graph.registry.phase(PARENT, 7, "applied")
  return { graph, resumeCalls }
}

test("design 20: a child already unpaused when the host died counts as resumed and is not resumed again", async () => {
  const { graph, resumeCalls } = graphOver({ status: "running" }, () => ({ turnId: "never" }))
  graph.registry.requestResume(PARENT, 7, "resume-1")
  graph.registry.update(PARENT, 7, "st_b", { state: "resuming" })
  await expect(graph.controller.resume(PARENT, 7, "resume-1")).resolves.toEqual({ kind: "installed" })
  expect(resumeCalls).toEqual([])
  expect(graph.registry.require(PARENT).participants.st_b?.state).toBe("resumed")
})

test("design 20: a child still paused under the run is resumed normally", async () => {
  const { graph, resumeCalls } = graphOver({ status: "paused", runPause: true }, () => ({ turnId: "turn-b" }))
  await expect(graph.controller.resume(PARENT, 7, "resume-1")).resolves.toEqual({ kind: "installed" })
  expect(resumeCalls).toEqual(["st_b"])
  expect(graph.registry.require(PARENT).participants.st_b).toMatchObject({ state: "resumed", resumeTurnId: "turn-b" })
})

for (const [name, answer, expected] of [
  ["names the newer hold", { otherHoldLive: true, childSeq: 9 }, 9],
  ["omits its sequence", { otherHoldLive: true }, 8],
] as const) {
  test(`design 32: a node whose own hold outlives the run's Resume stays held by the user when the engine ${name}`, async () => {
    const { graph } = graphOver({ status: "paused", runPause: true }, () => answer)
    await expect(graph.controller.resume(PARENT, 7, "resume-1")).resolves.toEqual({ kind: "installed" })
    expect(graph.registry.require(PARENT).participants.st_b).toMatchObject({ state: "held_by_user", observedChildSeq: expected })
    expect(graph.registry.require(PARENT).resume?.childSeqCutoffs.st_b).toBe(8)
  })
}
