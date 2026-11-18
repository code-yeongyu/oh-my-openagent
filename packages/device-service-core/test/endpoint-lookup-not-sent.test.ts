import { describe, expect, test } from "bun:test"
import { connectDeviceService, LocalApiError, NoPrimaryEndpointError, NotSentError } from "../src/index.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"

// An endpoint command looks the endpoint up with session.endpoints before it writes session.command. A failure of that
// lookup dispatched nothing, so the SDK marks it not_sent; a timeout of session.command itself keeps its command_id.
const ENDPOINT = "ZW5kcG9pbnQta2V5LTAwMD"

function client(lookup: () => Promise<unknown>, serviceVersion = "0.1.0") {
  const calls = { commandTo: 0, lookups: [] as unknown[], targets: [] as unknown[] }
  const fake = {
    welcome: { service_version: serviceVersion, capabilities: [], state: "connected" },
    request: async (type: string, payload: unknown) => {
      if (type === "session.endpoints") {
        calls.lookups.push(payload)
        return await lookup()
      }
      throw new Error(`unexpected request ${type}`)
    },
    commandTo: async (target: unknown, _rpc: unknown, commandId: string) => {
      calls.commandTo += 1
      calls.targets.push(target)
      throw new LocalApiError("request_timeout", `command ${commandId} may have been dispatched`, {
        command_id: commandId,
      })
    },
    onEvent: () => () => {},
    close: () => {},
    closed: new Promise<void>(() => {}),
  }
  return { connect: async () => fake as unknown as LocalApiClient, calls }
}

const failure = async (lookup: () => Promise<unknown>, serviceVersion?: string) => {
  const { connect, calls } = client(lookup, serviceVersion)
  const service = await connectDeviceService({ version: "0.0.0-test", stateDir: "/nonexistent", connect })
  const error = await service.endpointCommand("peer", { type: "open_session" }).catch((e: unknown) => e)
  return { error: error as LocalApiError & { readonly not_sent?: true }, calls }
}

describe("DeviceService.endpointCommand: a failed endpoint lookup is not_sent", () => {
  test("#given session.endpoints times out #when an endpoint command is sent #then it fails not_sent with the lookup's code and no command goes out", async () => {
    const { error, calls } = await failure(async () => {
      throw new LocalApiError("request_timeout", "no answer")
    })
    expect(error).toBeInstanceOf(NotSentError)
    expect(error.code).toBe("request_timeout")
    expect(error.not_sent).toBe(true)
    expect(error.command_id).toBeUndefined()
    expect(calls.commandTo).toBe(0)
  })

  test("#given the connection closes during session.endpoints #when an endpoint command is sent #then it fails not_sent with closed", async () => {
    const { error, calls } = await failure(async () => {
      throw new LocalApiError("closed", "the connection closed")
    })
    expect(error.code).toBe("closed")
    expect(error.not_sent).toBe(true)
    expect(calls.commandTo).toBe(0)
  })

  test("#given the device lists no endpoint #when an endpoint command is sent #then it is refused unsupported and not_sent", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [] }))
    expect(error.code).toBe("unsupported")
    expect(error.not_sent).toBe(true)
    expect(calls.commandTo).toBe(0)
  })

  test("#given the lookup answers #when session.command itself times out #then the error keeps its command_id and is not marked not_sent", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [ENDPOINT] }))
    expect(calls.commandTo).toBe(1)
    expect(error.code).toBe("request_timeout")
    expect(error.command_id).toBeDefined()
    expect(error.not_sent).toBeUndefined()
  })
})

// omo#14195: a remote create opens on the device's primary engine endpoint, never on whichever key the host listed first
// (an owner shard, or the engine of another registered agent dir that may predate the records a later send needs).
const SHARD = "c2hhcmQtZW5kcG9pbnQtMD"
const OTHER_DIR = "b3RoZXItYWdlbnQtZGlyLT"
const PRIMARY = "cHJpbWFyeS1lbmRwb2ludC"

describe("DeviceService.endpointCommand: opens on the device's primary engine endpoint (omo#14195)", () => {
  test("#given a 0.1.11+ service and a host naming a primary it does not list first #when an endpoint command is sent #then it asks for primary and opens there", async () => {
    const { error, calls } = await failure(
      async () => ({ endpoints: [OTHER_DIR, SHARD, PRIMARY], primary: PRIMARY }),
      "0.1.42",
    )
    expect(calls.lookups).toEqual([{ device: "peer", primary: true }])
    expect(calls.targets).toEqual([{ device: "peer", endpoint: PRIMARY }])
    expect(error.code).toBe("request_timeout")
  })

  test("#given a host listing several endpoints and naming no primary #when an endpoint command is sent #then it is refused NoPrimaryEndpointError, not_sent, and nothing is opened", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [OTHER_DIR, SHARD] }), "0.1.42")
    expect(error).toBeInstanceOf(NoPrimaryEndpointError)
    expect(error.not_sent).toBe(true)
    expect(calls.commandTo).toBe(0)
  })

  test("#given a 0.1.11+ service and a host listing only another agent dir's endpoint and naming no primary #when an endpoint command is sent #then it is refused NoPrimaryEndpointError and nothing is opened", async () => {
    const { error, calls } = await failure(async () => ({ endpoints: [OTHER_DIR] }), "0.1.42")
    expect(error).toBeInstanceOf(NoPrimaryEndpointError)
    expect(calls.commandTo).toBe(0)
  })

  test("#given a service older than 0.1.11 #when an endpoint command is sent #then the lookup carries no primary field", async () => {
    const { calls } = await failure(async () => ({ endpoints: [ENDPOINT] }), "0.1.10")
    expect(calls.lookups).toEqual([{ device: "peer" }])
    expect(calls.targets).toEqual([{ device: "peer", endpoint: ENDPOINT }])
  })
})
