import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"

import { ModelRegistry, ModelRuntime } from "@code-yeongyu/senpi"

import { InProcessRunner, RunnerError } from "./in-process"
import { baseSpec, createFakeSession, makeTool, tmpSessionDirs } from "./in-process-child-spec.test-support"
import type { CreateAgentSessionOptions } from "./in-process-child-spec.test-support"
import type { ChildSession } from "./in-process"

type RealModel = NonNullable<CreateAgentSessionOptions["model"]>

function realModel(provider: string, id: string): RealModel {
  const registry = new ModelRegistry(ModelRuntime.createSync())
  registry.registerProvider(provider, {
    api: "openai-completions",
    baseUrl: `file://${provider}-pin-test`,
    apiKey: "test-key",
    models: [{
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 4096,
    }],
  })
  const model = registry.find(provider, id)
  if (model === undefined) throw new Error(`registry did not serve ${provider}/${id}`)
  return model
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
afterEach(() => { unhandled.length = 0; while (tmpSessionDirs.length > 0) rmSync(tmpSessionDirs.pop() ?? "", { recursive: true, force: true }) })

describe("InProcessRunner", () => {
  test("#given a session that starts on a different model than the spec resolved #when start runs #then it fails typed as model_unavailable and disposes the session (#9722)", async () => {
    // given: the spec asks for model A; the engine hands back a session on model B
    const fake = createFakeSession()
    fake.session = { ...fake.session, model: { provider: "vendor-b", id: "substitute" } }
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when / then: the spawn refuses the substitution, and the opened session is torn down
    const failure = await runner
      .start(
        baseSpec({
          model: realModel("vendor-a", "pinned"),
          selectedModel: "vendor-a/pinned",
          resolvedModel: {
            provider: "vendor-a",
            model_id: "pinned",
            display: "vendor-a/pinned",
            source: "explicit",
          },
        }),
      )
      .catch((error: unknown) => error)
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(failure instanceof Error ? failure.message : "").toContain("vendor-b/substitute")
    expect(failure instanceof Error ? failure.message : "").toContain("vendor-a/pinned")
    expect(fake.disposeCount).toBe(1)
    expect(fake.promptCalls).toBe(0)
  })

  test("#given a mismatch whose session teardown also fails #when start runs #then the failure is still typed (#9722)", async () => {
    // given
    const fake = createFakeSession()
    fake.session = {
      ...fake.session,
      model: { provider: "vendor-b", id: "substitute" },
      dispose() {
        throw new Error("dispose exploded")
      },
    }
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const failure = await runner
      .start(
        baseSpec({
          model: realModel("vendor-a", "pinned"),
          selectedModel: "vendor-a/pinned",
          resolvedModel: {
            provider: "vendor-a",
            model_id: "pinned",
            display: "vendor-a/pinned",
            source: "explicit",
          },
        }),
      )
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(failure instanceof Error ? failure.message : "").toContain("shutting down its session failed")
  })

  test("#given a session on exactly the model the spec resolved #when start runs #then the child is accepted (#9722)", async () => {
    // given
    const fake = createFakeSession()
    fake.session = { ...fake.session, model: { provider: "vendor-a", id: "pinned" } }
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const handle = await runner.start(
      baseSpec({
        model: realModel("vendor-a", "pinned"),
        selectedModel: "vendor-a/pinned",
        resolvedModel: {
          provider: "vendor-a",
          model_id: "pinned",
          display: "vendor-a/pinned",
          source: "explicit",
        },
      }),
    )

    // then
    fake.lastText.value = "done"
    fake.resolvePrompt()
    await expect(handle.waitForIdle()).resolves.toMatchObject({ status: "completed" })
    await handle.dispose()
  })

  test.each([
    ["a -fast pin reported on its base model", "pinned-fast", "pinned"],
    ["a base pin reported on its -fast variant", "pinned", "pinned-fast"],
  ])("#given %s #when start runs #then the child is accepted, not refused as a substitution (#9793)", async (_label, pinnedId, startedId) => {
    // given: senpi starts a -fast catalog pin on its base model with the priority tier remembered
    const fake = createFakeSession()
    fake.session = {
      ...fake.session,
      ...{ effectiveServiceTier: "priority" },
      model: { provider: "vendor-a", id: startedId, serviceTier: "priority", upstreamModelId: "pinned" },
    }
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const handle = await runner.start(
      baseSpec({
        model: { ...realModel("vendor-a", pinnedId), serviceTier: "priority", upstreamModelId: "pinned" },
        selectedModel: `vendor-a/${pinnedId}`,
        resolvedModel: { provider: "vendor-a", model_id: pinnedId, display: `vendor-a/${pinnedId}`, source: "explicit" },
      }),
    )

    // then
    fake.lastText.value = "done"
    fake.resolvePrompt()
    await expect(handle.waitForIdle()).resolves.toMatchObject({ status: "completed" })
    await handle.dispose()
  })

  test.each([
    ["another model", "vendor-a", "other-model"],
    ["another suffix", "vendor-a", "pinned-ultra"],
    ["the base model on another provider", "vendor-b", "pinned"],
  ])("#given a -fast pin reported on %s #when start runs #then it is still refused as a substitution (#9793)", async (_label, provider, startedId) => {
    // given
    const fake = createFakeSession()
    fake.session = { ...fake.session, model: { provider, id: startedId } }
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const failure = await runner
      .start(
        baseSpec({
          model: realModel("vendor-a", "pinned-fast"),
          selectedModel: "vendor-a/pinned-fast",
          resolvedModel: { provider: "vendor-a", model_id: "pinned-fast", display: "vendor-a/pinned-fast", source: "explicit" },
        }),
      )
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(fake.promptCalls).toBe(0)
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
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec())

    fake.lastText.value = "final answer"
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    expect(outcome).toEqual({ status: "completed", finalResponse: "final answer" })
    expect(handle.lastAssistantText()).toBe("final answer")
  })

  test("#given shared and member-scoped tools #when a restricted child is started #then only member-scoped tools cross the family exclusion", async () => {
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

  test("#given a curated child with bash allowed #when the session is constructed #then a restricted bash override replaces the builtin", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec({ agentType: "explore", toolAllowlist: ["bash"] }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    const bashTools = (captured?.customTools ?? []).filter((tool) => tool.name === "bash")
    expect(bashTools).toHaveLength(1)
    expect(bashTools[0]?.description).toContain("read-only")
  })

  test("#given a non-curated child #when the session is constructed #then no bash override is injected", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec({ agentType: "scout", toolAllowlist: ["bash"] }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect((captured?.customTools ?? []).some((tool) => tool.name === "bash")).toBe(false)
  })

  test("#given a started child #when the session is constructed #then a persisted session manager rooted at the spec session dir is used", async () => {
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    const spec = baseSpec()
    const handle = await runner.start(spec)
    fake.resolvePrompt()
    await handle.waitForIdle()

    expect(captured?.sessionManager?.isPersisted()).toBe(true)
    expect(captured?.sessionManager?.getSessionDir()).toBe(spec.sessionDir)
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
  })})
