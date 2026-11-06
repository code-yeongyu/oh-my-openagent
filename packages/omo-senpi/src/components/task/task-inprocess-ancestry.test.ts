import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { ToolDefinition } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskTool } from "@oh-my-opencode/senpi-task"

import { EMPTY_SKILL_INVOCATIONS } from "../../../../senpi-task/src/agents/invocation-guard"
import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import { newestSessionPath } from "../../../../senpi-task/src/lifecycle/session-path"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createBuiltinChildMachine } from "../../../../senpi-task/src/runners/in-process/__fixtures__/builtin-child"
import { buildTaskExecute } from "../../../../senpi-task/src/tools/task/execute"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { DEFAULT_RUNNER_FACTORIES } from "./engine-runners"

const PROVIDER = "nested-ancestry"
const LEVELS = ["child", "grandchild", "great-grandchild"] as const

async function runTree(maxDepth: number, hostedParent = false) {
  const machine = await createBuiltinChildMachine()
  const tools: ToolDefinition[] = []
  const pi = new FakeExtensionAPI()
  if (hostedParent) {
    Object.defineProperty(pi, "sessionContext", {
      value: { role: "child", depth: "4", root_session_id: "tree-root" },
    })
  }
  // Only the provider is scripted. The sessions execute the inherited task tool,
  // the composed manager and the in-process runner without replacing their seams.
  Reflect.apply(machine.modelRegistry.registerProvider, machine.modelRegistry, [PROVIDER, {
    api: "openai-completions",
    baseUrl: "file://nested-ancestry",
    apiKey: "test-key",
    models: LEVELS.map((id) => ({
      id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000, maxTokens: 4096,
    })),
    streamSimple(model: { readonly id: string }, context: { readonly messages: readonly { readonly role: string }[] }) {
      const next = LEVELS[LEVELS.findIndex((level) => level === model.id) + 1]
      const delegate = next !== undefined && !context.messages.some((message) => message.role === "toolResult")
      const message = {
        role: "assistant",
        api: "openai-completions",
        provider: PROVIDER,
        model: model.id,
        content: delegate
          ? [{ type: "toolCall", id: `spawn-${next}`, name: "task", arguments: {
            category: next, prompt: "Delegate once, then finish.", run_in_background: false,
          } }]
          : [{ type: "text", text: "done" }],
        stopReason: delegate ? "toolUse" : "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.now(),
      }
      return {
        result: () => Promise.resolve(message),
        async *[Symbol.asyncIterator]() {
          yield { type: "done", reason: message.stopReason, message }
        },
      }
    },
  }])
  const engine = composeTaskEngine({
    pi,
    cwd: machine.cwd,
    env: {},
    omoConfig: {
      task: OmoTaskSettingsSchema.parse({
        state_dir: join(machine.agentDir, "tasks"),
        default_execution_mode: "in-process",
        max_depth: maxDepth,
        default_concurrency: 5,
      }),
      categories: Object.fromEntries(LEVELS.map((id) => [id, { model: `${PROVIDER}/${id}` }])),
    },
    sharedParentTools: () => tools,
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
    runnerFactories: {
      ...DEFAULT_RUNNER_FACTORIES,
      inProcess: (build) => DEFAULT_RUNNER_FACTORIES.inProcess({ ...build, agentDir: machine.agentDir }),
    },
  })
  const sessionId = hostedParent ? "hosted-parent" : "tree-root"
  engine.runtime.captureFrom({
    modelRegistry: machine.modelRegistry,
    sessionManager: { getSessionId: () => sessionId },
  })
  const deps = engine.taskToolDeps(() => EMPTY_SKILL_INVOCATIONS)
  const { renderCall: _renderCall, renderResult: _renderResult, ...taskTool } = createTaskTool(deps)
  tools.push(taskTool)
  try {
    const started = await buildTaskExecute(deps)(
      "root-call",
      { category: "child", prompt: "Delegate once, then finish.", run_in_background: true },
      undefined,
      undefined,
      { cwd: machine.cwd, sessionManager: { getSessionId: () => sessionId } },
    )
    expect(started.details.status).toBe("running")
    await engine.manager.waitFor(started.details.task_id)
    const { SessionManager } = await loadSenpiBarrel()
    const store = createTaskRecordStore({ project_dir: machine.cwd, task: { state_dir: join(machine.agentDir, "tasks") } })
    const records = engine.manager.list({ scope: "all" }).map(({ record }) => record)
    return {
      records,
      headers: records.map((record) => {
        const path = newestSessionPath({ store }, record.task_id)
        if (path === undefined) throw new Error(`missing transcript for ${record.task_id}`)
        return { record, header: SessionManager.open(path).getHeader() }
      }),
      rootScoped: engine.manager.list({ scope: "parent-session", session_id: "tree-root" }).map(({ record }) => record),
    }
  } finally {
    const parents = new Set([sessionId, ...engine.manager.list({ scope: "all" }).map(({ record }) => record.parent_session_id)])
    for (const parentSessionId of parents) {
      await engine.lifecycle.suspendOnSessionShutdown({ parentSessionId, reason: "quit" })
    }
    machine.cleanup()
  }
}

describe("nested in-process task ancestry (#10732)", () => {
  test.each([false, true])("records the tree root and each nested depth (hosted parent: %s)", async (hostedParent) => {
    // given a top-level engine, or an engine whose own session is already at depth 4
    const offset = hostedParent ? 4 : 0

    // when real in-process sessions delegate through their inherited task tools
    const { records, headers } = await runTree(offset + 3, hostedParent)
    const child = records.find((record) => record.category === "child")
    const grandchild = records.find((record) => record.category === "grandchild")
    const greatGrandchild = records.find((record) => record.category === "great-grandchild")

    // then each persisted edge keeps its immediate parent and the original root
    expect(records).toHaveLength(3)
    expect(child).toMatchObject({ root_session_id: "tree-root", depth: offset + 1, status: "completed" })
    expect(grandchild).toMatchObject({
      parent_session_id: child?.child_session_id, root_session_id: "tree-root", depth: offset + 2, status: "completed",
    })
    expect(greatGrandchild).toMatchObject({
      parent_session_id: grandchild?.child_session_id, root_session_id: "tree-root", depth: offset + 3, status: "completed",
    })
    for (const { record, header } of headers) {
      expect(header?.spawnedBy).toEqual({
        parentSessionId: record.parent_session_id, rootSessionId: "tree-root", taskId: record.task_id,
      })
    }
  }, 30_000)

  test("refuses a nested spawn at max_depth instead of treating its caller as a root", async () => {
    // given / when a child at the configured limit attempts to delegate
    const { records } = await runTree(1)

    // then the nested task never launches
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ category: "child", depth: 1, root_session_id: "tree-root", status: "completed" })
  }, 30_000)

  test("the root session's own scope covers every nested in-process descendant", async () => {
    // given a root whose child delegates twice more in-process
    const { records, rootScoped } = await runTree(3)

    // then the root's parent-session view (footer, /tasks, task_output, task_send) lists the whole tree,
    // the same as it already did for process-mode descendants
    expect(rootScoped.map((record) => record.category).sort()).toEqual(["child", "grandchild", "great-grandchild"])
    expect(rootScoped).toHaveLength(records.length)
  }, 30_000)
})
