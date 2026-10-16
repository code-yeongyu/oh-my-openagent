/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerV1Hooks } from "./hook-bridge"
import { OMO_DELEGATION_RULE } from "./delegation-routing"

test("v2 context gives catalog precedence over imported legacy tool instructions", async () => {
  const onContext: Array<(event: any) => Promise<void> | void> = []
  const ctx = {
    session: {
      hook: async (name: string, handler: (event: any) => Promise<void> | void) => {
        if (name === "context") onContext.push(handler)
      },
    },
  } as unknown as Plugin.Context
  const dispose = await registerV1Hooks(ctx, {
    "experimental.chat.system.transform": (_input: unknown, output: { system: string[] }) => {
      output.system.push("Legacy instruction: call mcp__lsp__get_tool_schema")
    },
  })
  try {
    const event = { sessionID: "child", model: { id: "claude", providerID: "anthropic" }, system: [] as { type: string; text: string }[] }
    for (const handler of onContext) await handler(event)
    const guidance = event.system.at(-1)!.text
    expect(guidance).toContain("Code Mode")
    expect(guidance).toContain("search")
    expect(guidance).toContain("execute")
    expect(guidance).toContain("do not create callable tools")
    for (const handler of onContext) await handler(event)
    expect(event.system.filter((part) => part.text === guidance)).toHaveLength(1)
  } finally {
    dispose()
  }
})

test("OMO routing hook runs without legacy transforms and leaves native agents unchanged", async () => {
  const onContext: Array<(event: any) => Promise<void> | void> = []
  const ctx = {
    session: {
      hook: async (name: string, handler: (event: any) => Promise<void> | void) => {
        if (name === "context") onContext.push(handler)
      },
    },
  } as unknown as Plugin.Context
  const dispose = await registerV1Hooks(ctx, {})
  try {
    const event = { agent: "Hephaestus - Deep Agent", system: [] as { type: "text"; text: string }[], tools: { subagent: {} } }
    for (const handler of onContext) await handler(event)
    expect(event.system.at(-1)?.text).toBe(OMO_DELEGATION_RULE)
    expect(OMO_DELEGATION_RULE).toContain("tools.task")
    expect(Object.hasOwn(event.tools, "subagent")).toBe(true)
    event.agent = "general"
    for (const handler of onContext) await handler(event)
    expect(event.system).toEqual([])
    expect(Object.hasOwn(event.tools, "subagent")).toBe(true)
  } finally {
    dispose()
  }
})

test("OMO rule follows legacy transforms, deduplicates, and clears on a custom-agent switch", async () => {
  const onContext: Array<(event: any) => Promise<void> | void> = []
  const ctx = {
    session: {
      hook: async (name: string, handler: (event: any) => Promise<void> | void) => {
        if (name === "context") onContext.push(handler)
      },
    },
  } as unknown as Plugin.Context
  const dispose = await registerV1Hooks(ctx, {
    "experimental.chat.system.transform": (_input: unknown, output: { system: string[] }) => {
      output.system.push("legacy-transformed-system")
    },
  })
  try {
    const event = { sessionID: "proof", agent: "oracle", model: { id: "proof", providerID: "local" }, system: [] as { type: "text"; text: string }[], tools: { subagent: {} } }
    for (let pass = 0; pass < 2; pass++) {
      for (const handler of onContext) await handler(event)
      expect(event.system.at(-1)?.text).toBe(OMO_DELEGATION_RULE)
      expect(event.system.filter((part) => part.text === OMO_DELEGATION_RULE)).toHaveLength(1)
      expect(event.system.some((part) => part.text === "legacy-transformed-system")).toBe(true)
    }
    event.agent = "custom-reviewer"
    for (const handler of onContext) await handler(event)
    expect(event.system.some((part) => part.text === OMO_DELEGATION_RULE)).toBe(false)
    expect(event.system.some((part) => part.text === "legacy-transformed-system")).toBe(true)
    expect(Object.hasOwn(event.tools, "subagent")).toBe(true)
  } finally {
    dispose()
  }
})
