import { type ChildProcess } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore } from "../store"
import { spawnFakeChild } from "../runners/rpc/__fixtures__/spawn-fake"
import { terminateRpcChild } from "../runners/rpc/terminate"
import { RpcProcessRunner } from "../runners/rpc-process"
import { createRpcManagedRunner } from "./runner"
import { categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

const children: ChildProcess[] = []

function createManager() {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const processRunner = new RpcProcessRunner({
    modelAdmission: async () => {},
    spawnChild: (descriptor) => {
      const child = spawnFakeChild(descriptor.env)
      children.push(child)
      return child
    },
  })
  const manager = createTaskManager({
    store,
    runners: {
      "in-process": new FakeRunner(),
      process: createRpcManagedRunner(processRunner),
    },
    planner: categoryPlanner(),
    config: settings({ default_execution_mode: "process", default_concurrency: 2, max_depth: 2 }),
    cwd: project,
  })
  return { manager, store }
}

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => terminateRpcChild(child, { sigkillDelayMs: 100 })))
  cleanupProjects()
})

describe("RPC terminal outcomes", () => {
  test("#given prompt preflight rejection #when a process task starts #then its running record becomes a typed start failure without an unhandled rejection", async () => {
    // given
    const { manager, store } = createManager()
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on("unhandledRejection", onRejection)

    // when
    const result = await manager.start({
      prompt: "prompt-error:model missing",
      parent_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      model: "fixture/model",
    })
    if (result.kind !== "start_failed" && result.kind !== "started") throw new Error(`unexpected ${result.kind}`)
    // A start slower than the report window returns `starting`; the failure then lands on the record (#10042).
    const record = await manager.waitFor(result.task_id)
    process.off("unhandledRejection", onRejection)

    // then
    expect(record.status).toBe("error")
    expect(record.error_message).toBe("Child prompt failed to start: the prompt was refused (host_refused).")
    if (result.kind === "start_failed") expect(result.error_message).toBe("Child prompt failed to start: the prompt was refused (host_refused).")
    expect(rejections).toEqual([])
  })

  test("#given provider failure after prompt admission #when the RPC turn ends #then the durable task becomes child-turn-failed instead of completed", async () => {
    // given
    const { manager, store } = createManager()

    // when
    const started = await manager.start({
      prompt: "turn-error:provider unavailable",
      parent_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      model: "fixture/model",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error("expected started")
    // A start slower than the report window returns before the child is resident, so read the child
    // only after its run is terminal (#10042).
    const terminal = await manager.waitFor(started.task_id)
    const handle = manager.getResidentHandle(started.task_id)
    if (handle === undefined) throw new Error("expected resident handle")
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome).toMatchObject({
      status: "error",
      failure: { kind: "child-turn-failed", message: "provider unavailable" },
    })
    expect(terminal.status).toBe("error")
    expect(terminal.error_message).toBe("provider unavailable")
    expect(store.load(started.task_id)?.status).toBe("error")
  })
})
