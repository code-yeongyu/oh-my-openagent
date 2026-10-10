import { describe, expect, test } from "bun:test"
import type { V2PluginContext, V2SessionPromptHook, V2ToolHookBefore, V2ToolHookAfter } from "./types"
import { registerV2SessionHooks } from "./session-hook-bridge"
import { registerV2ToolHooks } from "./tool-hook-bridge"
import { createCompatPluginInput } from "./compat-context"
import { createV1CompatClient } from "./client-facade"

function createStubV2Context(overrides: Partial<V2PluginContext> = {}): V2PluginContext {
  const registeredHooks: Array<{
    domain: string
    name: string
    callback: (event: never) => unknown
    dispose: () => Promise<void>
  }> = []
  const context: V2PluginContext = {
    app: { name: "opencode", version: "test", channel: "beta" },
    location: { directory: "C:\\project" },
    options: {},
    agent: {
      list: async () => ({ data: [] }),
      get: async () => ({}),
      transform: async (callback: (draft: unknown) => void) => {
        callback({})
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    tool: {
      transform: async (callback: (draft: unknown) => void) => {
        callback({})
        return { dispose: async () => {} }
      },
      reload: async () => {},
      hook: async <Name extends string>(name: Name, callback: (event: never) => unknown) => {
        registeredHooks.push({ domain: "tool", name, callback, dispose: async () => {} })
        return { dispose: async () => {} }
      },
    },
    mcp: {
      list: async () => ({ data: [] }),
      transform: async (callback: (draft: unknown) => void) => {
        callback({})
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    skill: {
      list: async () => ({ data: [] }),
      transform: async (callback: (draft: unknown) => void) => {
        callback({})
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    command: {
      list: async () => ({ data: [] }),
      transform: async (callback: (draft: unknown) => void) => {
        callback({})
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    session: {
      list: async () => ({ data: [] }),
      get: async () => ({}),
      create: async () => ({}),
      remove: async () => {},
      prompt: async () => ({}),
      synthetic: async () => ({}),
      interrupt: async () => ({}),
      compact: async () => ({}),
      wait: async () => {},
      context: async () => ({ data: [] }),
      message: async () => ({}),
      switchAgent: async () => {},
      switchModel: async () => {},
      hook: async <Name extends string>(name: Name, callback: (event: never) => unknown) => {
        registeredHooks.push({ domain: "session", name, callback, dispose: async () => {} })
        return { dispose: async () => {} }
      },
    },
    shell: {
      hook: async () => ({ dispose: async () => {} }),
    },
    event: {
      subscribe: async function* () {},
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    },
    catalog: {
      provider: {
        list: async () => ({ data: [] }),
        get: async () => ({}),
      },
      model: {
        list: async () => ({ data: [] }),
        default: async () => ({}),
      },
      transform: async () => ({ dispose: async () => {} }),
      reload: async () => {},
    },
    plugin: {
      list: async () => ({ data: [] }),
    },
    ...overrides,
  }
  return new Proxy(context, {
    get(target, prop) {
      if (prop === "__registeredHooks") return registeredHooks
      return (target as Record<string | symbol, unknown>)[prop]
    },
  }) as unknown as V2PluginContext
}

describe("registerV2SessionHooks", () => {
  test("#given V1 chat.message and system/params handlers #when registered #then prompt and context hooks are wired and mutations flow back", async () => {
    // given
    const seenInputs: unknown[] = []
    const hooks = {
      "chat.message": async (input: unknown, output: { parts: Array<{ type: string; text?: string }>; message: Record<string, unknown> }) => {
        seenInputs.push(input)
        output.parts.push({ type: "text", text: "[omo]" })
      },
      "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
        output.system.push("[omo-system]")
      },
      "chat.params": async (_input: unknown, output: { temperature?: number; options: Record<string, unknown> }) => {
        output.temperature = 0.4
        output.options["reasoningEffort"] = "high"
      },
    }
    const stub = createStubV2Context()
    // when
    const registrations = await registerV2SessionHooks({ ctx: stub, hooks: hooks as never })
    const registered = (stub as unknown as { __registeredHooks: Array<{ domain: string; name: string; callback: (event: never) => unknown }> }).__registeredHooks
    const promptHook = registered.find((entry) => entry.domain === "session" && entry.name === "prompt")
    const contextHook = registered.find((entry) => entry.domain === "session" && entry.name === "context")
    // then
    expect(promptHook).toBeDefined()
    expect(contextHook).toBeDefined()
    expect(registrations.length).toBeGreaterThan(0)

    const promptEvent: V2SessionPromptHook = {
      sessionID: "ses_1",
      messageID: "msg_1",
      prompt: { text: "hello" },
      delivery: "steer",
    }
    await promptHook!.callback(promptEvent as never)
    expect(promptEvent.prompt.text).toBe("hello[omo]")
    expect(seenInputs).toHaveLength(1)

    const contextEvent = {
      sessionID: "ses_1",
      agent: "sisyphus",
      model: { providerID: "openai", id: "gpt-5.6" },
      system: [{ type: "text", text: "base" }],
      messages: [],
      tools: {},
      generation: {},
      providerOptions: {},
    }
    await contextHook!.callback(contextEvent as never)
    expect(contextEvent.system.map((part) => part.text)).toEqual(["base", "[omo-system]"])
    expect(contextEvent.generation.temperature).toBe(0.4)
    expect(contextEvent.providerOptions["reasoningEffort"]).toBe("high")
  })

  test("#given no V1 handlers #when registered #then nothing is wired", async () => {
    // given
    const stub = createStubV2Context()
    // when
    const registrations = await registerV2SessionHooks({ ctx: stub, hooks: {} as never })
    const registered = (stub as unknown as { __registeredHooks: Array<{ domain: string; name: string }> }).__registeredHooks
    // then
    expect(registrations).toHaveLength(0)
    expect(registered).toHaveLength(0)
  })
})

describe("registerV2ToolHooks", () => {
  test("#given V1 tool execute.before/after handlers #when bridged #then args and results round-trip", async () => {
    // given
    const hooks = {
      "tool.execute.before": async (input: unknown, output: { args: Record<string, unknown> }) => {
        if ((input as { tool: string }).tool === "bash") {
          output.args["command"] = `${output.args["command"]} # hardened`
        }
      },
      "tool.execute.after": async (input: unknown, output: { title: string; output: string; metadata: Record<string, unknown> }) => {
        if ((input as { tool: string }).tool === "read") {
          output.output = `${output.output}\n[LINE#tagged]`
          output.metadata["tagged"] = true
        }
      },
    }
    const stub = createStubV2Context()
    // when
    await registerV2ToolHooks({ ctx: stub, hooks: hooks as never })
    const registered = (stub as unknown as { __registeredHooks: Array<{ domain: string; name: string; callback: (event: never) => unknown }> }).__registeredHooks
    const beforeHook = registered.find((entry) => entry.domain === "tool" && entry.name === "execute.before")
    const afterHook = registered.find((entry) => entry.domain === "tool" && entry.name === "execute.after")
    // then
    expect(beforeHook).toBeDefined()
    expect(afterHook).toBeDefined()

    const beforeEvent: V2ToolHookBefore = {
      tool: "bash",
      sessionID: "ses_1",
      agent: "sisyphus",
      messageID: "msg_1",
      id: "call_1",
      input: { command: "ls" },
    }
    await beforeHook!.callback(beforeEvent as never)
    expect((beforeEvent.input as Record<string, unknown>)["command"]).toBe("ls # hardened")

    const afterEvent: V2ToolHookAfter = {
      tool: "read",
      sessionID: "ses_1",
      agent: "sisyphus",
      messageID: "msg_1",
      id: "call_2",
      input: {},
      status: "completed",
      result: { content: "file contents" },
    }
    await afterHook!.callback(afterEvent as never)
    expect(afterEvent.result?.content).toBe("file contents\n[LINE#tagged]")
    expect(afterEvent.result?.metadata?.["tagged"]).toBe(true)
  })

  test("#given a failing V1 after-handler #when bridged #then the result is left intact", async () => {
    // given
    const hooks = {
      "tool.execute.after": async () => {
        throw new Error("boom")
      },
    }
    const stub = createStubV2Context()
    await registerV2ToolHooks({ ctx: stub, hooks: hooks as never })
    const registered = (stub as unknown as { __registeredHooks: Array<{ domain: string; name: string; callback: (event: never) => unknown }> }).__registeredHooks
    const afterHook = registered.find((entry) => entry.domain === "tool" && entry.name === "execute.after")
    const afterEvent: V2ToolHookAfter = {
      tool: "read",
      sessionID: "ses_1",
      agent: "sisyphus",
      messageID: "msg_1",
      id: "call_3",
      input: {},
      status: "completed",
      result: { content: "original" },
    }
    // when
    await afterHook!.callback(afterEvent as never)
    // then
    expect(afterEvent.result?.content).toBe("original")
  })
})

describe("client facade", () => {
  test("#given a V2 session domain #when prompt is called via the facade #then body parts are flattened to text", async () => {
    // given
    const prompts: Array<Record<string, unknown>> = []
    const stub = createStubV2Context({
      session: {
        list: async () => ({ data: [] }),
        get: async () => ({}),
        create: async () => ({}),
        remove: async () => {},
        prompt: async (input: Record<string, unknown>) => {
          prompts.push(input)
          return { ok: true }
        },
        synthetic: async () => ({}),
        interrupt: async () => ({}),
        compact: async () => ({}),
        wait: async () => {},
        context: async () => ({ data: [] }),
        message: async () => ({}),
        switchAgent: async () => {},
        switchModel: async () => {},
        hook: async () => ({ dispose: async () => {} }),
      } as never,
    })
    const client = createV1CompatClient(stub)
    // when
    const response = await client.session.promptAsync({
      path: { id: "ses_9" },
      body: {
        parts: [{ type: "text", text: "do work" }],
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.6" },
      },
    })
    // then
    expect(response).toEqual({ data: { ok: true } })
    expect(prompts).toEqual([
      {
        sessionID: "ses_9",
        text: "do work",
        delivery: "queue",
        agent: "sisyphus",
        model: { providerID: "openai", id: "gpt-5.6" },
      },
    ])
  })

  test("#given the todo degradation #when todo is called #then an empty list is returned", async () => {
    // given
    const stub = createStubV2Context()
    const client = createV1CompatClient(stub)
    // when
    const todos = await client.session.todo({ path: { id: "ses_1" } })
    // then
    expect(todos).toEqual({ data: { data: [] } })
  })
})

describe("createCompatPluginInput", () => {
  test("#given a V2 context #when converted #then the V1 plugin input fields are populated from the location", () => {
    // given
    const stub = createStubV2Context()
    // when
    const input = createCompatPluginInput(stub)
    // then
    expect(input.directory).toBe("C:\\project")
    expect(input.worktree).toBe("C:\\project")
    expect(input.client).toBeDefined()
    expect(input.serverUrl).toBeUndefined()
  })
})
