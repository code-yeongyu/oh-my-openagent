import { describe, expect, test } from "bun:test"
import { connectDeviceService, LocalApiError } from "../src/index.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"

// An endpoint command looks the endpoint up with session.endpoints before it writes session.command. A failure of that
// lookup dispatched nothing, so the SDK marks it not_sent; a timeout of session.command itself keeps its command_id.
const ENDPOINT = "ZW5kcG9pbnQta2V5LTAwMD"

function client(lookup: () => Promise<unknown>) {
  const calls = { endpointCommand: 0 }
  const fake = {
    welcome: { service_version: "t", capabilities: [], state: "connected" },
    request: async (type: string) => {
      if (type === "session.endpoints") return await lookup()
      throw new Error(`unexpected request ${type}`)
    },
    endpointCommand: async (_device: string, _endpoint: string, _rpc: unknown, commandId: string) => {
      calls.endpointCommand += 1
      throw new LocalApiError("request_timeout", `command ${commandId} may have been dispatched`, { command_id: commandId })
    },
    onEvent: () => () => {},
    close: () => {},
    closed: new Promise<void>(() => {}),
  }
  return { connect: async () => fake as unknown as LocalApiClient, calls }
}

const failure = async (lookup: () => Promise<unknown>) => {
  const { connect, calls } = client(lookup)
  const service = await connectDeviceService({ version: "0.0.0-test", stateDir: "/nonexistent", connect })
  const error = await service.endpointCommand("peer", { type: "open_session" }).catch((e: unknown) => e)
  return { error: error as LocalApiError, calls }
}

describe("DeviceService.endpointCommand: a failed endpoint lookup is not_sent", () => {
  test("#given session.endpoints times out #when an endpoint command is sent #then it fails not_sent with the lookup's code and no command goes out", async () => {
    const { error, calls } = await failure(async () => { throw new LocalApiError("request_timeout", "no answer") })
    expect(error).toBeInstanceOf(LocalApiError)
    expect(error.code).toBe("request_timeout")
    expect(error.not_sent).toBe(true)
    expect(error.command_id).toBeUndefined()
    expect(calls.endpointCommand).toBe(0)
  })

  test("#given the connection closes during session.endpoints #when an endpoint command is sent #then it fails not_sent with closed", async () => {
    const { error, calls } = await failure(async () => { throw new LocalApiError("closed", "the connection closed") })
    expect(error.code).toBe("closed")
    expect(error.not_sent).toBe(true)
    expect(calls.endpointCommand).toBe(0)
  })

  test("#given the device lists no endpoint #when an endpoint command is sent #then it is refused unsupported and not_sent", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [] }))
    expect(error.code).toBe("unsupported")
    expect(error.not_sent).toBe(true)
    expect(calls.endpointCommand).toBe(0)
  })

  test("#given the lookup answers #when session.command itself times out #then the error keeps its command_id and is not marked not_sent", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [ENDPOINT] }))
    expect(calls.endpointCommand).toBe(1)
    expect(error.code).toBe("request_timeout")
    expect(error.command_id).toBeDefined()
    expect(error.not_sent).toBeUndefined()
  })
})
