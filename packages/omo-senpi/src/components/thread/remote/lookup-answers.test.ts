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

  test.each([
    ["the post-create locate", "post-create"],
    ["an attach's locate of a durable id", "attach"],
  ] as const)(
    "#14748 review round 5: #given a capped solo lookup whose locate still runs #when %s is sent #then that locate starts only once the solo locate settled",
    async (_label, sender) => {
      const started: string[] = []
      let releaseSolo: () => void = () => {}
      const locate = async (device: string): Promise<{ readonly key: string }> => {
        started.push(device)
        if (device === "dev-b") await new Promise<void>((resolve) => (releaseSolo = resolve))
        return { key: `key-${device}` }
      }
      const service = {
        serviceVersion: "1.4.0",
        carriesWakeMark: true,
        takesSingleLocate: true,
        closed: new Promise(() => {}),
        locate,
        attach: async () => {
          throw new LocalApiError("unsupported", "no attach in this test")
        },
        close: () => {},
      } as unknown as DeviceService
      const port = sessionsPort({
        version: "5.1.70",
        connect: async () => ({ conn: service, owned: true }),
        lookupCapMs: 20,
      })
      const id = "0195f0c2-1a2b-7c3d-8e4f-00000000c001"
      expect(await port.lookupAlone?.("dev-b", id, 5_000)).toEqual({ kind: "silent", reason: "lookup_timeout" })

      const sent =
        sender === "post-create"
          ? port.locate("dev-c", "engine-1")
          : port.sessionCommand("dev-c", id, { type: "get_state", sessionId: id })
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
      expect(started).toEqual(["dev-b"])

      releaseSolo()
      await sent.catch(() => undefined)
      expect(started).toEqual(["dev-b", "dev-c"])
    },
  )

  test.each([
    ["the post-create locate", "post-create", { kind: "refused", reason: "locate_failed" }],
    ["an attach's locate of a durable id", "attach", { kind: "refused" }],
  ] as const)(
    "#14748 review round 6: #given a solo locate that never settles #when %s waits past one lookup cap #then it answers its typed refusal and nothing is sent beside the solo",
    async (_label, sender, expected) => {
      const started: string[] = []
      const locate = async (device: string): Promise<{ readonly key: string }> => {
        started.push(device)
        if (device === "dev-b") await new Promise<never>(() => {})
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
      await port.lookupAlone?.("dev-b", id, 5_000)

      const answer =
        sender === "post-create"
          ? await port.locate("dev-c", "engine-1")
          : await port.sessionCommand("dev-c", id, { type: "get_state", sessionId: id })

      expect(answer).toMatchObject(expected)
      expect(started).toEqual(["dev-b"])
    },
  )
})
