import { describe, expect, test } from "bun:test"
import { targetHookMappings } from "./event-map"
import { TargetHookDispatcher } from "./hook-dispatch"
import { registerTargetHookEvents, type TargetHookApi } from "./hook-registration"

describe("target hook normalization", () => {
  test("#given target hosts #when mapping hooks #then every hook tier has an explicit mapping", () => {
    for (const host of ["oh-my-pi", "pi"] as const) {
      const tiers = new Set(targetHookMappings(host).map((mapping) => mapping.tier))
      expect(tiers).toEqual(new Set(["session", "tool-guard", "transform", "continuation", "skill"]))
    }
    expect(targetHookMappings("pi").some((mapping) => mapping.targetEvent === "session.compacting")).toBe(false)
  })

  test("#given representative target events #when emitted #then each mapped tier dispatches", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const api: TargetHookApi = {
      on: (event, handler) => {
        handlers.set(event, handler)
      },
    }
    const dispatcher = new TargetHookDispatcher()
    const fired: string[] = []
    for (const tier of ["session", "tool-guard", "transform", "continuation"] as const) {
      dispatcher.on(tier, (event) => {
        fired.push(`${event.tier}:${event.name}`)
      })
    }
    registerTargetHookEvents("pi", api, dispatcher)
    await handlers.get("session_start")?.({}, {})
    await handlers.get("tool_call")?.({}, {})
    await handlers.get("context")?.({}, {})
    await handlers.get("session_compact")?.({}, {})
    expect(fired).toEqual([
      "session:session_start",
      "tool-guard:tool_call",
      "transform:context",
      "continuation:session_compact",
    ])
  })
})
