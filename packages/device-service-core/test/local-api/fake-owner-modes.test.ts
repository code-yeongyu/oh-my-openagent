import { afterEach, describe, expect, test } from "bun:test"
import {
  connectLocalApi,
  HANDSHAKE_TIMEOUT_MS,
  type LocalApiClient,
  REQUEST_TIMEOUT_MS,
} from "../../src/local-api/client.ts"
import { LocalApiError } from "../../src/local-api/errors.ts"
import type { CommandStateEvent, JsonObject, LocalEvent } from "../../src/local-api/protocol.ts"
import { type FakeClock, fakeClock } from "./conformance/fake-clock.ts"
import type { FakeOwner } from "./conformance/fake-owner.ts"
import { LEGACY_TERMINAL_COMMANDS } from "./conformance/fake-owner-modes.ts"
import { defaultWorld, PEER, SESSION_ID, type World } from "./conformance/world.ts"
import { cleanup, OMO, startModeOwner as startMode } from "./support.ts"

// Each fake-owner failure mode (design one-remote-module v6 section 9) proven over a real local socket against the local
// API client, with the client's handshake and request bounds on a fake clock: no test waits out a bound.

const ENDPOINT = "ZW5kcG9pbnQta2V5LTAwMQ"
const clients: LocalApiClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await cleanup()
})

const firstOutcome = defaultWorld().sessions[0]?.outcome ?? []
const endpointWorld = (): World => ({
  ...defaultWorld(),
  endpoints: { [PEER]: [ENDPOINT] },
  endpointCommand: { data: { answered: true }, outcome: firstOutcome },
})

const connect = async (owner: FakeOwner, clock: FakeClock): Promise<LocalApiClient> => {
  const client = await connectLocalApi({
    stateDir: owner.stateDir,
    client: OMO,
    handshakeTimer: clock.deadline,
    requestTimer: clock.deadline,
  })
  clients.push(client)
  return client
}

const collect = (client: LocalApiClient): LocalEvent[] => {
  const events: LocalEvent[] = []
  client.onEvent((event) => events.push(event))
  return events
}

// A request answered after `events` were sent: the connection is ordered, so every event the owner wrote before it is in.
const flush = async (client: LocalApiClient): Promise<void> => {
  await client.request("status.get", {})
}

const commandEvents = (events: readonly LocalEvent[], commandId: string): JsonObject[] =>
  events.flatMap((event) =>
    event.kind === "session.command_event" && "command_id" in event && event.command_id === commandId
      ? [event.response]
      : [],
  )

const statesOf = (events: readonly LocalEvent[], commandId: string): CommandStateEvent["state"][] =>
  events.flatMap((event) =>
    event.kind === "session.command_state" && event.command_id === commandId ? [event.state] : [],
  )

const codeOf = (error: unknown): string => (error instanceof LocalApiError ? error.code : String(error))

describe("fake owner modes", () => {
  test("silent-handshake reads the hello and never welcomes: the handshake bound fires on the fake clock", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("silent-handshake")
    const connecting = connectLocalApi({ stateDir: owner.stateDir, client: OMO, handshakeTimer: clock.deadline })
    const settled = connecting.then(
      (client) => {
        clients.push(client)
        return "connected"
      },
      (error: unknown) => codeOf(error),
    )
    await withheld("welcome")
    clock.advance(HANDSHAKE_TIMEOUT_MS - 1)
    expect(clock.armed()).toBe(1)
    clock.advance(1)
    expect(await settled).toBe("handshake_timeout")
  })

  test("silent-requests completes the handshake and never answers: the request bound fires on the fake clock", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("silent-requests")
    const client = await connect(owner, clock)
    const asking = client.request("devices.list", {}).then(
      () => "answered",
      (error: unknown) => codeOf(error),
    )
    await withheld("response")
    clock.advance(REQUEST_TIMEOUT_MS)
    expect(await asking).toBe("request_timeout")
    expect(owner.state.log).toEqual(["devices.list"])
  })

  test("ack-no-final acks the command with its id and progress states, never a reply or a final state", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("ack-no-final", endpointWorld())
    const client = await connect(owner, clock)
    const events = collect(client)
    const commandId = await client.endpointCommand(PEER, ENDPOINT, { type: "prompt", message: "hi" })
    await withheld("final_state")
    clock.advance(125_000)
    await flush(client)
    expect(statesOf(events, commandId)).toEqual(["queued", "transport_confirmed"])
    expect(commandEvents(events, commandId)).toEqual([])
  })

  test("attach-stall grants the attach and never sends its snapshot", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("attach-stall")
    const client = await connect(owner, clock)
    const events = collect(client)
    const { attach } = await client.request("session.attach", { device: PEER, session_id: SESSION_ID })
    await withheld("snapshot")
    clock.advance(32_000)
    await flush(client)
    expect(attach.length).toBeGreaterThan(0)
    expect(events.filter((event) => "attach" in event && event.attach === attach)).toEqual([])
  })

  test("silent-session sends the snapshot, then no record ever, and still answers a probe", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("silent-session")
    const client = await connect(owner, clock)
    const events = collect(client)
    const { attach } = await client.request("session.attach", { device: PEER, session_id: SESSION_ID })
    await withheld("records")
    for (let probe = 0; probe < 3; probe++) {
      clock.advance(30_000)
      await flush(client)
    }
    const kinds = events.flatMap((event) => ("attach" in event && event.attach === attach ? [event.kind] : []))
    expect(kinds).toEqual(["session.snapshot"])
    const commandId = await client.command(attach, { type: "get_state" })
    await flush(client)
    expect(statesOf(events, commandId).at(-1)).toBe("engine_applied")
  })

  test("terminal takes only its reduced control set and answers any other record as an unknown command", async () => {
    const clock = fakeClock()
    const replyTo = async (client: LocalApiClient, events: LocalEvent[], type: string) => {
      const commandId = await client.endpointCommand(PEER, ENDPOINT, { type })
      await flush(client)
      return commandEvents(events, commandId)[0]
    }
    const current = await startMode("terminal", endpointWorld())
    const client = await connect(current.owner, clock)
    const events = collect(client)
    expect(await replyTo(client, events, "interrupt")).toMatchObject({ success: true, data: { answered: true } })
    expect(await replyTo(client, events, "close_session")).toMatchObject({
      success: false,
      error: "Unknown command: close_session",
    })
    const legacy = await startMode("terminal", endpointWorld(), LEGACY_TERMINAL_COMMANDS)
    const older = await connect(legacy.owner, clock)
    const olderEvents = collect(older)
    expect(await replyTo(older, olderEvents, "get_state")).toMatchObject({ success: true })
    expect(await replyTo(older, olderEvents, "interrupt")).toMatchObject({
      success: false,
      error: "Unknown command: interrupt",
    })
  })
})
