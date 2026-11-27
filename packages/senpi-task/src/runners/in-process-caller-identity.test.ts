import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { awaitWithinTestBudget } from "../../../../test-support/test-deadline"

import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { createTaskCancelTool } from "../tools/control/cancel"
import type { CancelManager } from "../tools/control/types"
import { assistant, streamMessage } from "./__fixtures__/in-process-fallback-session"
import { InProcessRunner } from "./in-process"

const PROVIDER = "caller-identity-test"
const MODEL = "caller-identity"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function childMachine() {
  const senpi = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-caller-identity-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  const cwd = join(root, "work")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const modelRuntime = senpi.ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new senpi.ModelRegistry(modelRuntime)
  let calls = 0
  const provider = {
    api: "openai-completions",
    baseUrl: "file://caller-identity-test",
    apiKey: "test-key",
    models: [
      {
        id: MODEL,
        name: MODEL,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 4096,
      },
    ],
    streamSimple() {
      calls += 1
      if (calls > 1) return streamMessage(assistant(MODEL, "stop", "done", undefined, PROVIDER))
      const toolUse = assistant(MODEL, "toolUse", "", undefined, PROVIDER)
      return streamMessage({
        ...toolUse,
        content: [{ type: "toolCall", id: "call-cancel", name: "task_cancel", arguments: { task_id: "st_0000c0de" } }],
      })
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, [PROVIDER, provider])
  const model = modelRegistry.find(PROVIDER, MODEL)
  if (model === undefined) throw new Error("the model is missing from the fake provider")
  const { session: parent } = await senpi.createAgentSession({
    cwd,
    agentDir,
    sessionManager: senpi.SessionManager.inMemory(cwd),
    modelRuntime,
    modelRegistry,
    model,
  })
  const parentSessionId = parent.sessionManager.getSessionId()
  return {
    parentSessionId,
    closeParent: async () => {
      parent.dispose()
      await parent.whenToolChildClosed()
    },
    spec: {
      taskId: "st_identity",
      cwd,
      sessionDir: join(root, "children", "st_identity"),
      agentDir,
      projectTrusted: false,
      modelRuntime,
      modelRegistry,
      model,
      selectedModel: `${PROVIDER}/${MODEL}`,
      retry: { maxRetries: 0 },
      depth: 1,
      parentSessionId,
      rootSessionId: parentSessionId,
      prompt: "cancel the task",
      promptEnvelope: "bare" as const,
      completion: "turn" as const,
      includeTaskTools: true,
    },
  }
}

describe("task_cancel called from an in-process child", () => {
  test("#given the parent's task_cancel definition shared into a child #when the child calls it #then the caller is the child's session", async () => {
    const machine = await childMachine()
    const callers: Array<string | undefined> = []
    const manager: CancelManager = {
      cancelTask: async (idOrName, _reason, options) => {
        callers.push(options?.caller?.sessionId)
        return { kind: "not_found", reason: `No task found for "${idOrName}".` }
      },
      get: () => undefined,
    }
    const { renderCall: _renderCall, renderResult: _renderResult, ...cancelTool } = createTaskCancelTool({ manager })
    const runner = new InProcessRunner({ sharedParentTools: [cancelTool] })

    const handle = await runner.start(machine.spec)
    await awaitWithinTestBudget(handle.waitForIdle(), "the child's turn")
    await handle.abort()
    await handle.dispose()
    await machine.closeParent()

    expect(handle.sessionId).toBeDefined()
    expect(handle.sessionId).not.toBe(machine.parentSessionId)
    expect(callers).toEqual([handle.sessionId])
  })
})
