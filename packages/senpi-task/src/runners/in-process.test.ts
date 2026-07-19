import { afterEach, describe, expect, test } from "bun:test"

import { createReadToolDefinition, type CreateAgentSessionOptions, type ToolDefinition } from "@code-yeongyu/senpi"

import { InProcessRunner, RunnerError } from "./in-process"
import type { ChildSession, ChildSessionListener, ChildSpec } from "./in-process"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters

function makeTool(name: string, onExecute?: () => void): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => {
      onExecute?.()
      return { content: [{ type: "text", text: "ok" }], details: undefined }
    },
  }
}

type FakeSessionControls = {
  session: ChildSession
  resolvePrompt: () => void
  rejectPrompt: (error: unknown) => void
  emit: (event: { readonly type: string }) => void
  steerCalls: string[]
  followUpCalls: string[]
  abortCalls: number
  disposeCount: number
  lastText: { value: string | undefined }
  promptCalls: number
}

function createFakeSession(sessionId = "child-session-1"): FakeSessionControls {
  const listeners = new Set<ChildSessionListener>()
  const steerCalls: string[] = []
  const followUpCalls: string[] = []
  const lastText = { value: undefined as string | undefined }
  const counters = { abortCalls: 0, disposeCount: 0, promptCalls: 0 }
  let settle: { resolve: () => void; reject: (error: unknown) => void } | undefined
  const session: ChildSession = {
    sessionId,
    prompt() {
      counters.promptCalls += 1
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      })
    },
    async steer(text: string) {
      steerCalls.push(text)
    },
    async followUp(text: string) {
      followUpCalls.push(text)
    },
    async abort() {
      counters.abortCalls += 1
    },
    subscribe(listener: ChildSessionListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {
      counters.disposeCount += 1
    },
  }
  return {
    session,
    steerCalls,
    followUpCalls,
    lastText,
    get abortCalls() {
      return counters.abortCalls
    },
    get disposeCount() {
      return counters.disposeCount
    },
    get promptCalls() {
      return counters.promptCalls
    },
    resolvePrompt: () => settle?.resolve(),
    rejectPrompt: (error: unknown) => settle?.reject(error),
    emit: (event) => {
      for (const listener of listeners) listener(event)
    },
  }
}

function baseSpec(overrides: Partial<ChildSpec> = {}): ChildSpec {
  return {
    taskId: "task-1",
    cwd: process.cwd(),
    depth: 0,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt: "do the work",
    ...overrides,
  }
}

describe("InProcessRunner", () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  afterEach(() => {
    unhandled.length = 0
    process.off("unhandledRejection", onUnhandled)
  })

  test("#given a running child #when steered while the prompt is in flight #then the fake session receives it", async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    await handle.steer("adjust course")

    expect(fake.promptCalls).toBe(1)
    expect(fake.steerCalls).toEqual(["adjust course"])

    fake.lastText.value = "done"
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()
    expect(outcome).toEqual({ status: "completed", finalResponse: "done" })
  })

  test("#given a running child #when aborted mid-run #then outcome is cancelled and the session was aborted", async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    await handle.abort()
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    expect(fake.abortCalls).toBe(1)
    expect(outcome).toEqual({ status: "cancelled" })
  })

  test("#given an aborted child #when a follow-up revives it #then the revived turn completes with new final text", async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())
    await handle.abort()
    fake.resolvePrompt()
    await handle.waitForIdle()

    await handle.followUp("revive with new work")
    fake.lastText.value = "revived final"
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    expect(fake.promptCalls).toBe(2)
    expect(outcome).toEqual({ status: "completed", finalResponse: "revived final" })
  })

  test("#given a completing child #when idle #then the last assistant text is extracted", async () => {
    const fake = createFakeSession()
    fake.lastText.value = "final answer"
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    expect(outcome).toEqual({ status: "completed", finalResponse: "final answer" })
    expect(handle.lastAssistantText()).toBe("final answer")
  })

  test("#given shared and member-scoped tools #when a child is started #then only member-scoped tools cross the family exclusion", async () => {
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("grep"), makeTool("task_create")],
      uiOnlyToolNames: ["render_widget"],
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    const handle = await runner.start(baseSpec({ memberScopedTools: [makeTool("task_send")] }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    const names = (captured?.customTools ?? []).map((tool) => tool.name)
    expect(names).toEqual(["grep", "task_send"])
    for (const tool of captured?.customTools ?? []) {
      expect(typeof tool.execute).toBe("function")
    }
  })

  test("#given a tool allowlist and shared lsp tools #when a child is started #then options.tools equals the allowlist while customTools still carries the lsp tool", async () => {
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("lsp_diagnostics"), makeTool("grep")],
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    const handle = await runner.start(baseSpec({ toolAllowlist: ["read", "find", "grep", "ls", "bash"] }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    expect(captured?.tools).toEqual(["read", "find", "grep", "ls", "bash"])
    const customNames = (captured?.customTools ?? []).map((tool) => tool.name)
    expect(customNames).toEqual(["lsp_diagnostics", "grep"])
  })

  test("#given a started child #when the session is constructed #then an in-memory session manager is used", async () => {
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    const handle = await runner.start(baseSpec())
    fake.resolvePrompt()
    await handle.waitForIdle()

    expect(captured?.sessionManager?.isPersisted()).toBe(false)
    expect(captured?.resourceLoader?.getExtensions().extensions).toHaveLength(0)
  })

  test("#given a completed child #when the runner finishes #then it never disposes and dispose stays idempotent", async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    fake.resolvePrompt()
    await handle.waitForIdle()

    expect(fake.disposeCount).toBe(0)
    handle.dispose()
    handle.dispose()
    expect(fake.disposeCount).toBe(1)
  })

  test("#given a depth over policy #when start is called #then it refuses to construct the session", async () => {
    let createCalls = 0
    const runner = new InProcessRunner({
      depthPolicy: { maxDepth: 2 },
      createSession: async () => {
        createCalls += 1
        return createFakeSession().session
      },
    })

    const start = runner.start(baseSpec({ depth: 3 }))

    await expect(start).rejects.toBeInstanceOf(RunnerError)
    expect(createCalls).toBe(0)
    try {
      await start
    } catch (error) {
      expect(error instanceof RunnerError && error.failure.kind).toBe("depth-exceeded")
    }
  })

  test("#given a session that fails to construct #when start is called #then a typed session-create failure is thrown with cause", async () => {
    const cause = new Error("boot failed")
    const runner = new InProcessRunner({
      createSession: async () => {
        throw cause
      },
    })

    await expect(runner.start(baseSpec())).rejects.toMatchObject({
      failure: { kind: "session-create-failed", cause },
    })
  })

  test("#given a prompt that throws #when the child runs #then a typed failure is recorded, the child stays resident, and no rejection escapes", async () => {
    process.on("unhandledRejection", onUnhandled)
    const cause = new Error("prompt boom")
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    fake.rejectPrompt(cause)
    const outcome = await handle.waitForIdle()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-prompt-failed", message: "prompt boom", cause },
    })
    expect(fake.disposeCount).toBe(0)
    expect(unhandled).toEqual([])
  })

  test("#given a subscribed listener #when the child emits lifecycle events #then it observes agent_start before agent_end", async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())
    const seen: string[] = []
    handle.subscribe((event) => seen.push(event.type))

    fake.emit({ type: "agent_start" })
    fake.emit({ type: "agent_end" })
    fake.resolvePrompt()
    await handle.waitForIdle()

    expect(seen).toEqual(["agent_start", "agent_end"])
  })
})
