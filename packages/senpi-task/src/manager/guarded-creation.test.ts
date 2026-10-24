import { afterEach, describe, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import type { ChildCreationPort } from "../pause/ports"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("creation-time admission staging", () => {
  test("#given an in-flight child creation #when Stop closes before session initialization #then the first model call never starts", async () => {
    const cwd = tempProject()
    const barrier = new AdmissionBarrier()
    const created = Promise.withResolvers<void>()
    const continueCreation = Promise.withResolvers<void>()
    let modelCalls = 0
    const creation: ChildCreationPort = {
      startPaused: async (spec, _runner, ticket) => {
        created.resolve()
        await continueCreation.promise
        const fake = makeHandle(spec.taskId)
        return {
          child: fake.handle,
          activate: async () => {
            const decision = ticket.commit()
            if (decision.kind === "start_paused") return { kind: "paused", childSeq: 1, owner: decision.owner }
            modelCalls += 1
            return { turnId: "initial", outcome: fake.handle.waitForOutcome() }
          },
        }
      },
    }
    const runner = new FakeRunner()
    const store = createTaskRecordStore({ project_dir: cwd })
    const manager = createTaskManager({
      cwd, store, config: settings(), planner: categoryPlanner(),
      runners: { "in-process": runner, process: runner },
      admissionBarrier: barrier, childCreationPort: creation,
    })
    const spec = { ...baseSpec(), root_session_id: "root" }
    const starting = manager.start(spec)
    await Promise.race([
      created.promise,
      starting.then(() => { throw new Error("runner bypassed the creation-time admission port") }),
    ])
    barrier.close("root", 1)
    continueCreation.resolve()
    const result = await starting
    expect(result).toMatchObject({ kind: "held", pauseSeq: 1 })
    expect(modelCalls).toBe(0)
    expect(runner.startedSpecs).toHaveLength(0)
    if (result.kind !== "held") throw new Error("expected held creation")
    expect(manager.get(result.task_id)?.status).toBe("paused")
    expect(manager.concurrency?.leaseState(result.task_id, 0)).toBe("parked")
    expect(manager.getResidentHandle(result.task_id)).toBeDefined()
  })
})
