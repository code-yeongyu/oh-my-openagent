import { describe, expect, test } from "bun:test"
import { type DeviceService, LocalApiError } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"

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
  const port = createDeviceServiceSessions({ version: "5.1.70", connect: async () => serviceAnswering(answer) })
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
    const port = createDeviceServiceSessions({
      version: "5.1.70",
      connect: async () => serviceAnswering(() => new Promise(() => {})),
      lookupCapMs: 50,
    })
    const started = performance.now()
    expect(await port.lookup?.("dev-c", "0195f0c2-1a2b-7c3d-8e4f-00000000c001")).toEqual({
      kind: "silent",
      reason: "lookup_timeout",
    })
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
