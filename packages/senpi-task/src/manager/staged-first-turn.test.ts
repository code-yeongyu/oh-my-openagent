import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { nativeChildPausePort } from "../pause/native-child-pause"
import type { RunPauseOwner } from "../pause/ports"
import { InProcessRunner } from "../runners/in-process"
import { createFakeSession } from "../runners/in-process-child-spec.test-support"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { createInProcessManagedRunner } from "./runner"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

function nativeChild() {
  const fake = createFakeSession()
  const pauses: RunPauseOwner[] = []
  const held: { readonly inputId: string; readonly revision: number; readonly text: string }[] = []
  const session = Object.assign(fake.session, {
    pauseView: { records: [{ kind: "inherited_hold", parentSessionId: "root" }] },
    pauseForRun: async (owner: RunPauseOwner) => { pauses.push(owner); return { childSeq: 4 } },
    resumeForRun: async () => ({ released: true, otherHoldLive: false, turnId: "7" }),
    holdInput: (input: { readonly inputId: string; readonly revision: number; readonly text: string }) => {
      held.push(input)
      return { kind: "held" as const, entryId: "held-1", duplicate: false }
    },
  })
  return { fake, session, pauses, held }
}

function launchOver(createSession: () => Promise<ReturnType<typeof nativeChild>["session"]>) {
  const cwd = tempProject()
  const barrier = new AdmissionBarrier()
  const inProcess = createInProcessManagedRunner(new InProcessRunner({ createSession }))
  const manager = createTaskManager({
    cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(), planner: categoryPlanner(),
    runners: { "in-process": inProcess, process: new FakeRunner() },
    admissionBarrier: barrier, childPausePort: nativeChildPausePort,
  })
  return { barrier, manager }
}

test("H3: through the real in-process launch path, a child created across a Stop never sends its first prompt and holds it for Resume", async () => {
  const child = nativeChild()
  const creating = Promise.withResolvers<void>()
  const proceed = Promise.withResolvers<void>()
  const h = launchOver(async () => { creating.resolve(); await proceed.promise; return child.session })
  const starting = h.manager.start({ ...baseSpec(), root_session_id: "root", execution_mode: "in-process" })
  await creating.promise
  h.barrier.close("root", 1)
  proceed.resolve()
  const result = await starting
  expect(result).toMatchObject({ kind: "held", pauseSeq: 1 })
  if (result.kind !== "held") throw new Error("expected a held start")
  try {
    expect(child.fake.promptCalls).toBe(0)
    expect(child.pauses).toEqual([{ parentSessionId: "root", parentPauseSeq: 1, runRef: { kind: "task", id: result.task_id } }])
    expect(child.held).toHaveLength(1)
    expect(child.held[0]?.text).toContain("do the thing")
    expect(h.manager.get(result.task_id)?.status).toBe("paused")
  } finally { await h.manager.cancelTask(result.task_id) }
})

test("H3: through the real in-process launch path, a child created with admission open sends its first prompt once", async () => {
  const child = nativeChild()
  const h = launchOver(async () => child.session)
  const result = await h.manager.start({ ...baseSpec(), root_session_id: "root", execution_mode: "in-process" })
  if (result.kind !== "started") throw new Error(`expected a started child, got ${result.kind}`)
  try {
    expect(child.fake.promptCalls).toBe(1)
    expect(child.fake.promptTexts[0]).toContain("do the thing")
    expect(child.pauses).toEqual([])
    expect(child.held).toEqual([])
  } finally { await h.manager.cancelTask(result.task_id) }
})
