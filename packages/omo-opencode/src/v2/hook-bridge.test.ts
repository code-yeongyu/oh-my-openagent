import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { V2EventBus } from "./event-bus"
import {
  listDeferredBridges,
  registerEventBridge,
  registerHookBridge,
  registerPromptHook,
  registerToolHooks,
} from "./hook-bridge"
import type { V1BridgeHooks, V2HookBridgeContext } from "./hook-bridge"

type CapturedCallback = (input: never) => Promise<void> | void

function buildHookHost() {
  const calls: Array<{ name: string; callback: CapturedCallback }> = []
  const disposed: string[] = []
  const hook = async (name: string, callback: CapturedCallback) => {
    calls.push({ name, callback })
    return {
      dispose: async () => {
        disposed.push(name)
      },
    }
  }
  return { calls, disposed, hook }
}

function buildV2Ctx() {
  const session = buildHookHost()
  const tool = buildHookHost()
  const ctx = {
    session: { hook: session.hook },
    tool: { hook: tool.hook },
  } as unknown as V2HookBridgeContext
  return { ctx, session, tool }
}

function buildBus() {
  const handlers = new Map<string, Array<CapturedCallback>>()
  let unsubscribed = 0
  const bus = {
    on: (type: string, handler: CapturedCallback) => {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
      return () => {
        unsubscribed += 1
        handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler))
      }
    },
  } as unknown as V2EventBus
  const emit = async (type: string, data: unknown) => {
    for (const handler of handlers.get(type) ?? []) await handler({ type, data } as never)
  }
  const unsubscribeCount = () => unsubscribed
  return { bus, emit, unsubscribeCount }
}

function fullV1Hooks(): V1BridgeHooks {
  return {
    "tool.execute.before": async () => {},
    "tool.execute.after": async () => {},
    event: async () => {},
    "chat.message": async () => {},
    "experimental.chat.messages.transform": async () => {},
    "experimental.chat.system.transform": async () => {},
    "experimental.session.compacting": async () => {},
  }
}

describe("#given full V1 hooks", () => {
  describe("#when registering the hook bridge", () => {
    it("#then registers the expected V2 hook names", async () => {
      // given
      const { ctx, session, tool } = buildV2Ctx()
      const { bus } = buildBus()

      // when
      await registerHookBridge(ctx, bus, fullV1Hooks())

      // then
      expect(session.calls.map((call) => call.name).sort()).toEqual([
        "compaction",
        "context",
        "context",
        "prompt",
      ])
      expect(tool.calls.map((call) => call.name).sort()).toEqual(["execute.after", "execute.before"])
    })
  })

  describe("#when disposing the bridge", () => {
    it("#then disposes every registration", async () => {
      // given
      const { ctx, session, tool } = buildV2Ctx()
      const { bus, unsubscribeCount } = buildBus()
      const bridge = await registerHookBridge(ctx, bus, fullV1Hooks())

      // when
      await bridge.disposeAll()

      // then
      expect(session.disposed.sort()).toEqual(["compaction", "context", "context", "prompt"])
      expect(tool.disposed.sort()).toEqual(["execute.after", "execute.before"])
      expect(unsubscribeCount()).toBe(6)
      expect(bridge.deferred).toEqual(listDeferredBridges())
    })
  })
})

describe("#given a V1 tool.execute.before handler", () => {
  describe("#when the V2 before hook fires", () => {
    it("#then forwards tool/sessionID/callID and writes mutated args back", async () => {
      // given
      const { ctx, tool } = buildV2Ctx()
      const seen: Array<{ tool: string; sessionID: string; callID: string }> = []
      await registerToolHooks(ctx.tool, {
        "tool.execute.before": async (input, output) => {
          seen.push({ tool: input.tool, sessionID: input.sessionID, callID: input.callID })
          output.args = { ...output.args, extra: true }
        },
      })
      const v2input = {
        tool: "bash",
        sessionID: "ses-1",
        agent: "sisyphus",
        messageID: "m-1",
        id: "call-1",
        input: { command: "ls" },
      }

      // when
      await tool.calls[0]?.callback(v2input as never)

      // then
      expect(seen).toEqual([{ tool: "bash", sessionID: "ses-1", callID: "call-1" }])
      expect(v2input.input).toEqual({ command: "ls", extra: true })
    })
  })
})

describe("#given a V1 tool.execute.after handler", () => {
  describe("#when the V2 after hook completes", () => {
    it("#then converts string result to output and writes mutations back", async () => {
      // given
      const { ctx, tool } = buildV2Ctx()
      const received: string[] = []
      await registerToolHooks(ctx.tool, {
        "tool.execute.after": async (_input, output) => {
          received.push(output.output)
          output.output = "hi!"
        },
      })
      const v2input = {
        tool: "bash",
        sessionID: "ses-1",
        agent: "sisyphus",
        messageID: "m-1",
        id: "call-1",
        input: {},
        status: "completed",
        result: { content: "hello", metadata: {} },
      }

      // when
      await tool.calls[0]?.callback(v2input as never)

      // then
      expect(received).toEqual(["hello"])
      expect(v2input.result.content).toBe("hi!")
    })
  })

  describe("#when the V2 after hook reports an error", () => {
    it("#then skips the V1 handler", async () => {
      // given
      const { ctx, tool } = buildV2Ctx()
      let called = 0
      await registerToolHooks(ctx.tool, {
        "tool.execute.after": async () => {
          called += 1
        },
      })

      // when
      await tool.calls[0]?.callback({
        tool: "bash",
        sessionID: "ses-1",
        agent: "sisyphus",
        messageID: "m-1",
        id: "call-1",
        input: {},
        status: "error",
        error: { message: "boom" },
      } as never)

      // then
      expect(called).toBe(0)
    })
  })
})

describe("#given a V1 event handler", () => {
  describe("#when a V2 session.idle event arrives", () => {
    it("#then translates it into a V1 event call with the sessionID", async () => {
      // given
      const { ctx } = buildV2Ctx()
      const { bus, emit } = buildBus()
      const received: Array<{ type: string; properties: unknown }> = []
      await registerEventBridge(ctx, bus, {
        event: async (input) => {
          received.push({ type: input.event.type, properties: input.event.properties })
        },
      })

      // when
      await emit("session.idle", { sessionID: "ses-9" })
      await emit("session.tool.called", { sessionID: "ses-9" })

      // then
      expect(received).toEqual([{ type: "session.idle", properties: { sessionID: "ses-9" } }])
    })
  })
})

describe("#given a V1 chat.message handler", () => {
  describe("#when the V2 prompt hook fires", () => {
    it("#then writes appended text back into the prompt", async () => {
      // given
      const { ctx, session } = buildV2Ctx()
      await registerPromptHook(ctx.session, {
        "chat.message": async (_input, output) => {
          const first = output.parts[0]
          if (first && typeof first.text === "string") first.text = `${first.text} [injected]`
        },
      })
      const v2input = {
        sessionID: "ses-1",
        messageID: "m-1",
        prompt: { text: "ultrawork" },
        delivery: "queue",
      }

      // when
      await session.calls[0]?.callback(v2input as never)

      // then
      expect(v2input.prompt.text).toBe("ultrawork [injected]")
    })
  })
})

describe("#given listDeferredBridges", () => {
  describe("#when consumed by setup-v2", () => {
    it("#then names the deferred command and tool-definition bridges", () => {
      // given
      const deferred = listDeferredBridges()

      // when
      const sorted = [...deferred].sort()

      // then
      expect(sorted).toEqual(["command.execute.before", "tool.definition"])
    })
  })
})

describe("#given an absent V1 hook set", () => {
  describe("#when registering with empty hooks", () => {
    it("#then registers nothing and disposes cleanly", async () => {
      // given
      const { ctx, session, tool } = buildV2Ctx()
      const { bus } = buildBus()

      // when
      const bridge = await registerHookBridge(ctx, bus, {})

      // then
      expect(session.calls).toEqual([])
      expect(tool.calls).toEqual([])
      await bridge.disposeAll()
      expect(bridge.deferred).toEqual(["command.execute.before", "tool.definition"])
    })
  })
})
