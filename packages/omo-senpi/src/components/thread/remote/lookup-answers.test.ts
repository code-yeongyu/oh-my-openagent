import { describe, expect, test } from "bun:test"
import { type DeviceService, LocalApiError } from "@oh-my-opencode/device-service-core"
import { closingPorts } from "./testing/closing-ports"

// #13873: every port is closed after each test, so no idle detach timer outlives it.
const sessionsPort = closingPorts()

// omo#13037 A7.2.6: the sender's own device service answers a single-probe locate toward a device that does not list
// the wake feature with the empty page - the `session_not_found` refusal, sent with no query going out. The lookup
// reads that as "answered, none"; only a device that did not answer (`host_not_answering`), or one that lists the
// feature and still cannot take the id query (`unsupported`), is silent and so can make a send `host_unavailable`.

function serviceAnswering(answer: () => Promise<{ readonly key: string }>): DeviceService {
  return {
    serviceVersion: "1.4.0",
    carriesWakeMark: true,
    takesSingleLocate: true,
    closed: new Promise(() => {}),
    locate: answer,
    close: () => {},
  } as unknown as DeviceService
}

const lookupWith = async (answer: () => Promise<{ readonly key: string }>) => {
  const port = sessionsPort({
    version: "5.1.70",
    connect: async () => ({ conn: serviceAnswering(answer), owned: true }),
  })
  return await port.lookup?.("dev-c", "0195f0c2-1a2b-7c3d-8e4f-00000000c001")
}

describe("omo#13037 A7.2.6: how the single probe's answers are read", () => {
  test("#given the device holds the session #then it is found with its key", async () => {
    expect(await lookupWith(async () => ({ key: "S0VZ" }))).toEqual({ kind: "found", key: "S0VZ" })
  })

  test.each(["session_not_found", "peer_not_found", "peer_not_session_client"] as const)(
    "#given the probe is refused %s (an empty page, or a device with no standing) #then it is answered, none",
    async (code) => {
      expect(
        await lookupWith(async () => {
          throw new LocalApiError(code, "refused")
        }),
      ).toEqual({ kind: "none" })
    },
  )

  test.each(["host_not_answering", "unsupported"] as const)(
    "#given the probe is refused %s #then the device is silent, the only answer that can make a send host_unavailable",
    async (code) => {
      expect(
        await lookupWith(async () => {
          throw new LocalApiError(code, "refused")
        }),
      ).toEqual({ kind: "silent", reason: code })
    },
  )

  test("review: #given a service that never answers the single probe #then the lookup returns silent within the client's own cap", async () => {
    const port = sessionsPort({
      version: "5.1.70",
      connect: async () => ({ conn: serviceAnswering(() => new Promise(() => {})), owned: true }),
      lookupCapMs: 50,
    })
    const started = performance.now()
    expect(await port.lookup?.("dev-c", "0195f0c2-1a2b-7c3d-8e4f-00000000c001")).toEqual({
      kind: "silent",
      reason: "lookup_timeout",
    })
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  test("#14748 review M1/M3: #given a locate still running past its lookup's cap, and two callers asking alone at once #then each solo locate starts only after every earlier locate finished, and a plain lookup waits while a solo one runs", async () => {
    let inFlight = 0
    const inFlightAtStart: Record<string, number> = {}
    let releaseCapped: () => void = () => {}
    const locate = async (device: string): Promise<{ readonly key: string }> => {
      inFlight += 1
      inFlightAtStart[device] = inFlight
      if (device === "dev-b") await new Promise<void>((resolve) => (releaseCapped = resolve))
      else await Promise.resolve()
      inFlight -= 1
      return { key: `key-${device}` }
    }
    const service = {
      serviceVersion: "1.4.0",
      carriesWakeMark: true,
      takesSingleLocate: true,
      closed: new Promise(() => {}),
      locate,
      close: () => {},
    } as unknown as DeviceService
    const port = sessionsPort({
      version: "5.1.70",
      connect: async () => ({ conn: service, owned: true }),
      lookupCapMs: 20,
    })
    const id = "0195f0c2-1a2b-7c3d-8e4f-00000000c001"
    expect(await port.lookup?.("dev-b", id)).toEqual({ kind: "silent", reason: "lookup_timeout" })

    const first = port.lookupAlone?.("dev-c", id, 5_000)
    const second = port.lookupAlone?.("dev-d", id, 5_000)
    releaseCapped()

    expect(await Promise.all([first, second])).toEqual([
      { kind: "found", key: "key-dev-c" },
      { kind: "found", key: "key-dev-d" },
    ])
    expect(inFlightAtStart).toEqual({ "dev-b": 1, "dev-c": 1, "dev-d": 1 })
  })
})
