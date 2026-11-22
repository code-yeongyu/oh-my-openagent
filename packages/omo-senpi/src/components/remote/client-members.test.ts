import { afterEach, describe, expect, test } from "bun:test"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"

// The 4a-2 behaviour of the client's own members (#13747 review M1): the control gate, the wake switch and its two
// refusals, status's service version, the unanswered devices, durable ids on rows, and the not-yet-landed members. The
// device service is a stub handed in through the `connect` seam, so each row states exactly what the service reports;
// the owner's state dir only satisfies the installed-service check.

afterEach(closeClients)

type Stub = Partial<Record<keyof DeviceService, unknown>>
const SELF = { id: "dev-self", name: "self" }
const stubService = (stub: Stub): DeviceService =>
  ({
    serviceVersion: "0.1.37",
    capabilities: ["sessions", "devices", "control"],
    carriesWakeMark: true,
    wakeMarkMinimum: "0.1.30",
    closed: new Promise<void>(() => {}),
    close: () => {},
    status: async () => ({ state: "connected", enabled: true }),
    thisDevice: async () => SELF,
    devices: async () => [],
    ...stub,
  }) as unknown as DeviceService

const clientWith = async (stub: Stub, sender?: Parameters<typeof clientOn>[2]) => {
  const owner = await startOwner()
  return clientOn(owner.stateDir, fakeClock(), sender, { connect: async () => stubService(stub) })
}

const valueOf = <T>(outcome: { readonly kind: "ok"; readonly value: T } | { readonly kind: "error" }): T => {
  if (outcome.kind !== "ok") throw new Error(`expected a value, got ${JSON.stringify(outcome)}`)
  return outcome.value
}

describe("service.control / setControl", () => {
  test("#given a service without the control capability #when the attach setting is read or set #then unsupported{control}, and the service is never asked", async () => {
    let asked = 0
    const client = await clientWith({
      capabilities: ["sessions", "devices"],
      attachControl: async () => (asked += 1),
      setAttachControl: async () => (asked += 1),
    })
    expect(failureOf(await client.service.control())).toMatchObject({
      code: "unsupported",
      details: { feature: "control" },
    })
    expect(failureOf(await client.service.setControl(true))).toMatchObject({
      code: "unsupported",
      details: { feature: "control" },
    })
    expect(asked).toBe(0)
  })
})

describe("service.wake / setWake", () => {
  test("#given a build that carries no wake switch #then not_in_build; given a service older than the switch #then service_too_old", async () => {
    const notInBuild = await clientWith({ carriesWakeMark: false, wakeMarkMinimum: null })
    expect(failureOf(await notInBuild.service.wake())).toMatchObject({
      code: "unsupported",
      details: { feature: "wake", reason: "not_in_build" },
    })
    const tooOld = await clientWith({ carriesWakeMark: false, wakeMarkMinimum: "0.1.30" })
    expect(failureOf(await tooOld.service.wake())).toMatchObject({
      code: "unsupported",
      details: { feature: "wake", reason: "service_too_old" },
    })
  })

  test("#given a service that carries it #when a person sets it and a session tries #then the person's value is stored and the session is refused", async () => {
    const stored: (boolean | null)[] = []
    const stub = {
      sessionWake: async () => ({ enabled: true, stored: null, changedAt: "", overridden: false }),
      setSessionWake: async (enabled: boolean | null) => {
        stored.push(enabled)
        return { enabled: enabled ?? true, stored: enabled, changedAt: "", overridden: false }
      },
    }
    expect(valueOf(await (await clientWith(stub)).service.setWake(null))).toMatchObject({ enabled: true, stored: null })
    expect(
      failureOf(await (await clientWith(stub, { kind: "session", id: "dur-1" })).service.setWake(false)).code,
    ).toBe("sender_not_allowed")
    expect(stored).toEqual([null])
  })
})

describe("service.status", () => {
  test("#given a connected service #then one call answers its state and the version of the service that reported it", async () => {
    const client = await clientWith({ serviceVersion: "0.1.37" })
    const status = valueOf(await client.service.status())
    expect([status.state, status.enabled, status.service_version]).toEqual(["connected", true, "0.1.37"])
  })
})

describe("sessions.list", () => {
  test("#given a device that missed the round and one whose answer was cut short #then both are unanswered, once each", async () => {
    const listing = {
      revision: 7,
      rows: [
        {
          device: "dev-a",
          session_id: "key-1",
          durable_id: "dur-1",
          title: "t",
          project: "p",
          path: "/p",
          state: "idle",
          updated_ms: 1,
          source: "live",
        },
      ],
      devices: { "dev-a": "answered", "dev-b": "timeout", "dev-c": "answered" },
      incomplete: ["dev-c", "dev-b"],
    }
    const client = await clientWith({ sessions: async () => listing })
    const list = valueOf(await client.sessions.list())
    expect(list.unanswered.map((row) => row.id).sort()).toEqual(["dev-b", "dev-c"])
    expect(list.rows.map((row) => ({ thread: String(row.thread), durable_id: row.durable_id }))).toEqual([
      { thread: "dev-a/key-1", durable_id: "dur-1" },
    ])
  })
})

describe("members whose part has not landed", () => {
  test("#given this build #when each later member is called #then each answers unsupported naming it, as data", async () => {
    const client = await clientWith({})
    const thread = "dev-a/key-1" as Parameters<typeof client.sessions.get>[0]
    const features = [failureOf(await client.aliases.resolve("a"))].map((failure) => [
      failure.code,
      failure.details?.["feature"],
    ])
    expect(features).toEqual([["unsupported", "aliases"]])
  })
})

describe("the connect phase", () => {
  test("#given a service that refuses the connection #when any member runs #then its failure says phase connect, so a caller can tell a stopped service from a member's own failure", async () => {
    const owner = await startOwner()
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    const client = clientOn(owner.stateDir, fakeClock(), undefined, { connect: async () => Promise.reject(refused) })
    expect(failureOf(await client.service.status())).toMatchObject({ details: { phase: "connect" } })
    expect(failureOf(await client.devices.list())).toMatchObject({ details: { phase: "connect" } })
  })
})
