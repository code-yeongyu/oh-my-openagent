import { describe, expect, test } from "bun:test"
import { connectDeviceService, LocalApiError } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"

// The adapter over the real SDK: an endpoint command whose endpoint lookup fails sent nothing and is refused (a create
// or fork may be retried); the same timeout after session.command was written may have run and stays uncertain.
function portFor(lookup: "timeout" | "closed" | "answers") {
  const calls = { endpointCommand: 0 }
  const fake = {
    welcome: { service_version: "t", capabilities: [], state: "connected" },
    request: async (type: string) => {
      if (type !== "session.endpoints") throw new Error(`unexpected request ${type}`)
      if (lookup === "timeout") throw new LocalApiError("request_timeout", "no answer")
      if (lookup === "closed") throw new LocalApiError("closed", "the connection closed")
      return { endpoints: ["ZW5kcG9pbnQta2V5LTAwMD"] }
    },
    endpointCommand: async (_device: string, _endpoint: string, _rpc: unknown, commandId: string) => {
      calls.endpointCommand += 1
      throw new LocalApiError("request_timeout", `command ${commandId} may have been dispatched`, {
        command_id: commandId,
      })
    },
    onEvent: () => () => {},
    close: () => {},
    closed: new Promise<void>(() => {}),
  }
  const port = createDeviceServiceSessions({
    version: "0.0.0-test",
    connect: () =>
      connectDeviceService({ version: "0.0.0-test", stateDir: "/nonexistent", connect: async () => fake as never }),
  })
  return { port, calls }
}

describe("device-service adapter: endpoint lookup failures versus lost replies", () => {
  test("#given b's endpoint lookup times out #when create sends to b #then nothing was sent and it is refused request_timeout", async () => {
    const { port, calls } = portFor("timeout")
    expect(await port.endpointCommand("b", { type: "open_session", cwd: "/p" })).toEqual({
      kind: "refused",
      reason: "request_timeout",
    })
    expect(calls.endpointCommand).toBe(0)
  })

  test("#given the connection closes during b's endpoint lookup #when fork sends to b #then it is refused closed", async () => {
    const { port, calls } = portFor("closed")
    expect(await port.endpointCommand("b", { type: "fork" })).toEqual({ kind: "refused", reason: "closed" })
    expect(calls.endpointCommand).toBe(0)
  })

  test("#given the lookup answered #when session.command times out after sending #then it stays uncertain reply_lost", async () => {
    const { port, calls } = portFor("answers")
    expect(await port.endpointCommand("b", { type: "open_session", cwd: "/p" })).toEqual({
      kind: "uncertain",
      reason: "reply_lost",
    })
    expect(calls.endpointCommand).toBe(1)
  })
})
