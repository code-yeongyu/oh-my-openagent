import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_AGENTS, CURATED_READONLY_AGENT_NAMES, ULW_REVIEWER_AGENT_NAMES } from "../../agents/builtin"
import { DEFAULT_CATEGORIES } from "../../category"
import { fakeKernelTools } from "../../runners/in-process/__fixtures__/kernel-tools-fakes"
import { buildTaskExecute } from "./execute"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import type { TaskToolContext, TaskToolDetails } from "./types"

// The tool surface a real omo parent shares with an in-process child (UI-only names and the
// task/team family are already filtered out by the engine's childToolNames resolver).
const CHILD_TOOLS = ["read", "grep", "find", "ls", "write", "edit", "bash", "web_search", "lsp_symbols"]
const DEFAULT_OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

function harness() {
  const capability = fakeKernelTools()
  capability.define({ name: "lookup" })
  const specs: unknown[] = []
  const record = makeRecord({ status: "running" })
  const manager = createFakeManager({
    start: async (spec) => {
      specs.push(spec)
      return { kind: "started", task_id: record.task_id, run_epoch: 0, status: "running", name: "kernel-child" }
    },
    get: () => record,
  })
  const deps = makeDeps(manager, {
    omoConfig: DEFAULT_OMO_CONFIG,
    agents: BUILTIN_AGENTS,
    resolveChildToolNames: () => CHILD_TOOLS,
  })
  const context = { ...CTX, kernelTools: capability } as TaskToolContext
  const spawn = async (target: Record<string, unknown>): Promise<TaskToolDetails> =>
    (await buildTaskExecute(deps)("call-1", {
      prompt: "use the parent tool",
      run_in_background: true,
      tools: ["lookup"],
      ...target,
    } as never, undefined, undefined, context)).details
  return { spawn, specs }
}

/**
 * The shipped default configuration must keep working: an `agent()` child and every default
 * category child still receive parent kernel tools under the real definitions. Only the agents
 * whose OWN definition narrows their write surface are refused.
 */
describe("kernel-tool grants under the real default omo config", () => {
  test("#given the shipped default agent() child (a category target with no agent persona) #when it requests a parent tool #then the grant reaches the manager", async () => {
    const { spawn, specs } = harness()

    const details = await spawn({ category: "unspecified-high" })

    expect(details.kernel_tools?.granted).toEqual(["lookup"])
    expect(details.kernel_tools?.error).toBeUndefined()
    expect(specs).toHaveLength(1)
  })

  test("#given every default category #when a child of it requests a parent tool #then the grant is never refused", async () => {
    const { spawn } = harness()

    const refused: string[] = []
    for (const category of Object.keys(DEFAULT_CATEGORIES)) {
      const details = await spawn({ category })
      if (details.kernel_tools?.error !== undefined) refused.push(category)
    }

    expect(Object.keys(DEFAULT_CATEGORIES)).toContain("quick")
    expect(Object.keys(DEFAULT_CATEGORIES)).toContain("unspecified-high")
    expect(refused).toEqual([])
  })

  test("#given the builtin agents #when each requests a parent tool #then curated agents and write-narrowed reviewers are refused by code", async () => {
    const { spawn } = harness()

    const codes: Record<string, string | undefined> = {}
    for (const name of Object.keys(BUILTIN_AGENTS)) {
      codes[name] = (await spawn({ subagent_type: name })).kernel_tools?.error?.code
    }

    for (const name of CURATED_READONLY_AGENT_NAMES) expect(codes[name]).toBe("curated_policy_denied")
    for (const name of ULW_REVIEWER_AGENT_NAMES) expect(codes[name]).toBe("tools_unavailable")
  })
})
