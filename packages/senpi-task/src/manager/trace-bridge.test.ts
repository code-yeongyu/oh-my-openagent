import { type ChildProcess } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore } from "../store"
import { spawnFakeChild } from "../runners/rpc/__fixtures__/spawn-fake"
import { OMO_SENPI_TASK_TRACEPARENT } from "../runners/rpc/spawn"
import { readSessionTraceparent } from "../runners/rpc-host/session-role"
import { terminateRpcChild } from "../runners/rpc/terminate"
import { RpcProcessRunner } from "../runners/rpc-process"
import { createRpcManagedRunner } from "./runner"
import { categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

const children: ChildProcess[] = []

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => terminateRpcChild(child, { sigkillDelayMs: 100 })))
  cleanupProjects()
})

describe("delegating turn trace context across the task bridge", () => {
  test("#given a parent session with a live turn #when it starts a process child #then the child process is launched with that turn's traceparent and reads it back as an omo child", async () => {
    // given
    const delegating = "00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01"
    const project = tempProject()
    const asked: string[] = []
    const { promise: spawned, resolve: onSpawn } = Promise.withResolvers<NodeJS.ProcessEnv>()
    const processRunner = new RpcProcessRunner({
      modelAdmission: async () => {},
      spawnChild: (descriptor) => {
        onSpawn(descriptor.env)
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    })
    const manager = createTaskManager({
      store: createTaskRecordStore({ project_dir: project }),
      runners: { "in-process": new FakeRunner(), process: createRpcManagedRunner(processRunner) },
      planner: categoryPlanner(),
      config: settings({ default_execution_mode: "process", default_concurrency: 2, max_depth: 2 }),
      cwd: project,
      traceparentFor: (parentSessionId) => {
        asked.push(parentSessionId)
        return parentSessionId === "parent-1" ? delegating : undefined
      },
    })

    // when
    const started = await manager.start({
      prompt: "do it",
      parent_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      model: "fixture/model",
      run_in_background: true,
    })
    const env = await Promise.race([
      spawned,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("waited 10s for the child spawn, it never happened")), 10_000)),
    ])

    // then
    expect(started.kind).toBe("started")
    expect(asked).toEqual(["parent-1"])
    expect(env[OMO_SENPI_TASK_TRACEPARENT]).toBe(delegating)
    expect(readSessionTraceparent({}, env)).toBe(delegating)
  })
})
