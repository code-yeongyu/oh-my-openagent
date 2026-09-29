import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { createModelCacheState } from "./plugin-state"
import { registerToolGuardV2Hooks, stripMcpPrefix } from "./v2-tool-guards"

type CapturedEvent = {
  tool: string
  sessionID: string
  agent: string
  messageID: string
  id: string
  input: unknown
}

describe("v2 tool guards", () => {
  it("strips the mcp_ prefix", () => {
    // given a model-emitted mcp_ tool name
    // when normalized
    // then the registry name is restored
    expect(stripMcpPrefix("mcp_background_output")).toBe("background_output")
    expect(stripMcpPrefix("read")).toBe("read")
  })

  it("registers an execute.before hook that normalizes the tool call", async () => {    // given a fake v2 context capturing the hook callback
    let captured: ((event: CapturedEvent) => Promise<void> | void) | undefined
    const ctx = {
      location: { directory: "/tmp/v2-guard-test" },
      tool: {
        hook: async (
          _name: string,
          callback: (event: CapturedEvent) => Promise<void> | void,
        ) => {
          captured = callback
        },
      },
    }
    const event: CapturedEvent = {
      tool: "mcp_read",
      sessionID: "ses-test",
      agent: "build",
      messageID: "msg-test",
      id: "call-test",
      input: { filePath: "/tmp/v2-guard-test/notes.md" },
    }

    // when setup registers guards and the server invokes the callback
    await registerToolGuardV2Hooks(ctx as unknown as Plugin.Context, { pluginConfig: {}, modelCacheState: createModelCacheState() })
    await captured?.(event)

    // then the tool name was normalized and args pass through
    expect(captured).not.toBeUndefined()
    expect(event.tool).toBe("read")
    expect(event.input).toEqual({ filePath: "/tmp/v2-guard-test/notes.md" })
  })

  it("blocks prometheus writes outside plan files", async () => {    // given a recorded prometheus agent and a fake before-hook capture
    const { setSessionAgent, clearSessionAgent } = await import(
      "./features/claude-code-session-state"
    )
    setSessionAgent("ses-prometheus-test", "prometheus")
    let captured: ((event: CapturedEvent) => Promise<void> | void) | undefined
    const ctx = {
      location: { directory: "/tmp/v2-guard-test" },
      tool: {
        hook: async (
          _name: string,
          callback: (event: CapturedEvent) => Promise<void> | void,
        ) => {
          captured = callback
        },
      },
    }
    const event: CapturedEvent = {
      tool: "write",
      sessionID: "ses-prometheus-test",
      agent: "prometheus",
      messageID: "msg-test",
      id: "call-test",
      input: { filePath: "/tmp/v2-guard-test/notes.md" },
    }

    try {
      // when registered and invoked
      await registerToolGuardV2Hooks(ctx as unknown as Plugin.Context, { pluginConfig: {}, modelCacheState: createModelCacheState() })
      const error = await captured?.(event).then(
        () => undefined,
        (failure: unknown) => failure,
      )

      // then the write was blocked
      expect(captured).not.toBeUndefined()
      expect(error).toBeInstanceOf(Error)
    } finally {
      clearSessionAgent("ses-prometheus-test")
    }
  })

  it("honors disabled_hooks for the write guard", async () => {    // given the write guard disabled and an overwrite without prior read
    let captured: ((event: CapturedEvent) => Promise<void> | void) | undefined
    const ctx = {
      location: { directory: "/tmp/v2-guard-test" },
      tool: {
        hook: async (
          _name: string,
          callback: (event: CapturedEvent) => Promise<void> | void,
        ) => {
          captured = callback
        },
      },
    }
    const event: CapturedEvent = {
      tool: "write",
      sessionID: "ses-disabled-test",
      agent: "build",
      messageID: "msg-test",
      id: "call-test",
      input: { filePath: "/tmp/v2-guard-test/existing.md", content: "new" },
    }

    // when registered with the guard disabled and invoked
    await registerToolGuardV2Hooks(ctx as unknown as Plugin.Context, {
      pluginConfig: { disabled_hooks: ["write-existing-file-guard"] },
      modelCacheState: createModelCacheState(),
    })
    const error = await captured?.(event).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    // then the write proceeds (no guard to block it)
    expect(captured).not.toBeUndefined()
    expect(error).toBeUndefined()
  })
})
