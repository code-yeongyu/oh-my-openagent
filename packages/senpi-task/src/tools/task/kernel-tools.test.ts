import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import { fakeKernelTools } from "../../runners/in-process/__fixtures__/kernel-tools-fakes"
import { normalizeTaskToolArguments } from "./argument-normalization"
import { buildTaskExecute } from "./execute"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import type { TaskToolContext } from "./types"

function contextWith(capability: unknown): TaskToolContext {
  return { ...CTX, kernelTools: capability } as TaskToolContext
}

function started(taskId: string): StartResult {
  return { kind: "started", task_id: taskId, run_epoch: 0, status: "running", name: "kernel-child" }
}

describe("task tool kernel-tool names", () => {
  test("#given raw arguments carrying tools #when normalized for the real tool surface #then the names survive", () => {
    expect(normalizeTaskToolArguments({ prompt: "p", category: "quick", tools: ["lookup", " ", 7] })).toMatchObject({
      tools: ["lookup"],
    })
    expect(normalizeTaskToolArguments({ prompt: "p", category: "quick" }).tools).toBeUndefined()
  })

  test("#given a live JS parent and requested names #when the child spawns #then the transient grant reaches the manager and the handle keeps the real identity", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    const specs: ManagerStartSpec[] = []
    const record = makeRecord({ status: "running" })
    const manager = createFakeManager({
      start: async (spec) => {
        specs.push(spec)
        return started(record.task_id)
      },
      get: () => record,
    })

    const result = await buildTaskExecute(makeDeps(manager))(
      "call-1",
      { prompt: "use the parent tool", category: "quick", run_in_background: true, tools: ["lookup"] },
      undefined,
      undefined,
      contextWith(capability),
    )

    expect(specs).toHaveLength(1)
    expect(specs[0]?.kernelTools?.descriptors.map((descriptor) => descriptor.name)).toEqual(["lookup"])
    expect(result.details.task_id).toBe(record.task_id)
    expect(result.details.run_epoch).toBe(record.notification.run_epoch)
  })

  test("#given a requested name the parent never defined #when spawning #then NO child session is started and the denial is typed", async () => {
    const capability = fakeKernelTools()
    let starts = 0
    const manager = createFakeManager({
      start: async () => {
        starts += 1
        return started("st_00000002")
      },
    })

    const result = await buildTaskExecute(makeDeps(manager))(
      "call-2",
      { prompt: "use a missing tool", category: "quick", run_in_background: true, tools: ["missing"] },
      undefined,
      undefined,
      contextWith(capability),
    )

    expect(starts).toBe(0)
    expect(result.details.status).toBe("denied")
    expect(result.details.kernel_tools?.status).toBe("refused")
    expect(result.details.kernel_tools?.error?.code).toBe("kernel_tool_missing")
  })

  test("#given an agent that runs in process mode #when it requests a parent tool #then no child starts and the refusal is typed", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    let starts = 0
    const manager = createFakeManager({
      start: async () => {
        starts += 1
        return started("st_00000006")
      },
    })
    const deps = makeDeps(manager, { agents: { "rpc-worker": { name: "rpc-worker", executionMode: "process" } } })

    const result = await buildTaskExecute(deps)(
      "call-6",
      { prompt: "use the parent tool", subagent_type: "rpc-worker", run_in_background: true, tools: ["lookup"] },
      undefined,
      undefined,
      contextWith(capability),
    )

    expect(starts).toBe(0)
    expect(result.details.kernel_tools?.status).toBe("refused")
    expect(result.details.kernel_tools?.error?.code).toBe("tools_unavailable")
    expect(capability.invocations).toEqual([])
  })

  test("#given a parent with no live JS kernel #when names are requested #then the spawn is refused as tools_unavailable", async () => {
    let starts = 0
    const manager = createFakeManager({
      start: async () => {
        starts += 1
        return started("st_00000003")
      },
    })

    const result = await buildTaskExecute(makeDeps(manager))(
      "call-3",
      { prompt: "use the parent tool", category: "quick", run_in_background: true, tools: ["lookup"] },
      undefined,
      undefined,
      CTX,
    )

    expect(starts).toBe(0)
    expect(result.details.kernel_tools?.error?.code).toBe("tools_unavailable")
  })

  test("#given a curated read-only agent #when it requests a parent tool #then the spawn is refused as curated_policy_denied", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    let starts = 0
    const manager = createFakeManager({
      start: async () => {
        starts += 1
        return started("st_00000004")
      },
    })

    const result = await buildTaskExecute(makeDeps(manager))(
      "call-4",
      { prompt: "review", subagent_type: "explore", run_in_background: true, tools: ["lookup"] },
      undefined,
      undefined,
      contextWith(capability),
    )

    expect(starts).toBe(0)
    expect(result.details.kernel_tools?.error?.code).toBe("curated_policy_denied")
  })

  test("#given a batch item requesting names #when one item is denied #then no child of that item spawns and the batch reports the code", async () => {
    const capability = fakeKernelTools()
    const specs: ManagerStartSpec[] = []
    const record = makeRecord({ status: "running" })
    const manager = createFakeManager({
      start: async (spec) => {
        specs.push(spec)
        return started(record.task_id)
      },
      get: () => record,
      waitFor: async () => record,
    })

    const result = await buildTaskExecute(makeDeps(manager))(
      "call-5",
      {
        category: "quick",
        run_in_background: true,
        tools: ["missing"],
        tasks: [{ prompt: "one" }, { prompt: "two" }],
      },
      undefined,
      undefined,
      contextWith(capability),
    )

    expect(specs).toHaveLength(0)
    expect(result.details.kernel_tools?.error?.code).toBe("kernel_tool_missing")
  })
})
