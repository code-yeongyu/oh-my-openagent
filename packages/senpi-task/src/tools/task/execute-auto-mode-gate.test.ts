import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents/types"
import type { ExecutionMode, ExecutionModeGate, ManagerStartSpec, StartResult } from "../../manager"
import { fakeKernelTools } from "../../runners/in-process/__fixtures__/kernel-tools-fakes"
import { buildTaskExecute } from "./execute"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import type { TaskToolContext } from "./types"
import type { TaskToolParamsStatic } from "./params"

const AGENTS: Readonly<Record<string, AgentDefinition>> = {
  explorer: { name: "explorer", executionMode: "in-process" },
  builder: { name: "builder", executionMode: "process" },
}

function configWith(defaultMode: "auto" | "in-process"): OmoConfig {
  return { categories: {}, agents: {}, task: OmoTaskSettingsSchema.parse({ default_execution_mode: defaultMode }) }
}

function countingGate(answer: ExecutionMode): ExecutionModeGate & { readonly ensures: () => number } {
  let ensures = 0
  let settled: ExecutionMode | undefined
  return {
    ensures: () => ensures,
    current: () => settled,
    ensure: () => {
      ensures += 1
      settled = answer
      return Promise.resolve(answer)
    },
    warm: () => Promise.resolve(),
  }
}

async function runCall(input: {
  readonly defaultMode: "auto" | "in-process"
  readonly params: TaskToolParamsStatic
  readonly ctx?: TaskToolContext
}) {
  const gate = countingGate("process")
  const specs: ManagerStartSpec[] = []
  const record = makeRecord({ status: "running" })
  const manager = createFakeManager({
    start: async (spec): Promise<StartResult> => {
      specs.push(spec)
      return { kind: "started", task_id: record.task_id, run_epoch: 0, status: "running", name: "child" }
    },
    get: () => record,
  })
  const deps = makeDeps(manager, { omoConfig: configWith(input.defaultMode), agents: AGENTS, executionModeGate: gate })
  const result = await buildTaskExecute(deps)("call", input.params, undefined, undefined, input.ctx ?? CTX)
  return { ensures: gate.ensures(), specs, result }
}

describe("a task call that can only run in-process never ensures the session's task host (IS-9)", () => {
  test("#given auto and a call whose only target is an in-process agent with a kernel-tool grant #when it runs #then the gate is never asked and the grant resolves in-process", async () => {
    // given
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    // when
    const run = await runCall({
      defaultMode: "auto",
      params: { prompt: "look around", subagent_type: "explorer", run_in_background: true, tools: ["lookup"] },
      ctx: { ...CTX, kernelTools: capability } as TaskToolContext,
    })

    // then
    expect(run.ensures).toBe(0)
    expect(run.result.details.kernel_tools?.status).toBe("granted")
    expect(run.specs.map((spec) => spec.execution_mode)).toEqual(["in-process"])
  })

  test("#given auto and a batch mixing that agent with an unsettled category #when it runs #then the gate is asked exactly once, before any spec", async () => {
    // when
    const run = await runCall({
      defaultMode: "auto",
      params: {
        tasks: [
          { prompt: "look around", subagent_type: "explorer" },
          { prompt: "say hi", category: "quick" },
        ],
        run_in_background: true,
      },
    })

    // then
    expect(run.ensures).toBe(1)
    expect(run.specs.map((spec) => spec.execution_mode)).toEqual(["in-process", "process"])
  })

  test("#given auto and a target configured process #when it runs #then the gate is asked once", async () => {
    // when
    const run = await runCall({
      defaultMode: "auto",
      params: { prompt: "build it", subagent_type: "builder", run_in_background: true },
    })

    // then
    expect(run.ensures).toBe(1)
  })

  test("#given default_execution_mode in-process #when a category target runs #then the gate is never asked", async () => {
    // when
    const run = await runCall({
      defaultMode: "in-process",
      params: { prompt: "say hi", category: "quick", run_in_background: true },
    })

    // then
    expect(run.ensures).toBe(0)
    expect(run.specs.map((spec) => spec.execution_mode)).toEqual(["in-process"])
  })
})
