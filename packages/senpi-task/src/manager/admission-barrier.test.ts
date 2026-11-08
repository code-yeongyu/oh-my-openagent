import { afterEach, describe, expect, test } from "bun:test"
import { createTaskManager } from "./manager"
import { createTaskRecordStore } from "../store"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("manager start admission belongs to the root before any await", () => {
  test("#given delayed residency #when Stop closes admission #then no child is created when admission completes", async () => {
    const cwd = tempProject()
    const barrier = new AdmissionBarrier()
    const admission = Promise.withResolvers<void>()
    const runner = new FakeRunner()
    const manager = createTaskManager({
      cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(),
      runners: { "in-process": runner, process: runner }, admissionBarrier: barrier,
      planner: categoryPlanner(),
      admit: async () => { await admission.promise; return { kind: "admitted" } },
    })
    const spec = { ...baseSpec(), root_session_id: "root" }
    const starting = manager.start(spec)
    expect(barrier.inFlight(spec.root_session_id)).toHaveLength(1)
    barrier.close(spec.root_session_id, 1)
    admission.resolve()
    expect(await starting).toMatchObject({ kind: "held", pauseSeq: 1 })
    expect(runner.startedSpecs).toHaveLength(0)
    expect(barrier.inFlight(spec.root_session_id)).toHaveLength(0)
  })

  test("#given closed admission #when start is called #then the planner is never invoked", async () => {
    const cwd = tempProject()
    const barrier = new AdmissionBarrier()
    const spec = { ...baseSpec(), root_session_id: "root" }
    barrier.close(spec.root_session_id, 1)
    let planned = 0
    const runner = new FakeRunner()
    const manager = createTaskManager({
      cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(),
      runners: { "in-process": runner, process: runner }, admissionBarrier: barrier,
      planner: input => { planned += 1; return categoryPlanner()(input) },
    })
    expect(await manager.start(spec)).toMatchObject({ kind: "held", pauseSeq: 1 })
    expect(planned).toBe(0)
    expect(runner.startedSpecs).toHaveLength(0)
  })
})
