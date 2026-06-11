import { describe, expect, it } from "bun:test"
import { registerTargetOpenClaw } from "./openclaw"

describe("target OpenClaw hooks", () => {
  it("#given disabled OpenClaw #when registered #then no target hooks or dispatch side effects occur", () => {
    const events: string[] = []
    registerTargetOpenClaw({ on: (event) => { events.push(event) } }, { enabled: false, gateways: {}, hooks: {} }, "/tmp")
    expect(events).toEqual([])
  })

  it("#given enabled OpenClaw #when session starts #then outbound target event dispatches", async () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown | Promise<unknown>>()
    const dispatched: string[] = []
    registerTargetOpenClaw(
      { on: (event, handler) => { handlers.set(event, handler) } },
      { enabled: true, gateways: {}, hooks: {} },
      "/work",
      async ({ rawEvent }) => { dispatched.push(rawEvent); return null },
    )
    await handlers.get("session_start")?.({ sessionId: "one" }, {})
    expect(dispatched).toEqual(["session.created"])
  })
})
