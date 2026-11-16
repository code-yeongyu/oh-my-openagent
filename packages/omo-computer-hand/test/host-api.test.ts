import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { callHostApi, serveHostApi, type EnsureCaller, type HostAddress } from "../src/index.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-api-")

async function withServer<T>(address: HostAddress, run: (ensured: EnsureCaller[]) => Promise<T>): Promise<T> {
  const ensured: EnsureCaller[] = []
  const server = await serveHostApi(address, {
    status: () => ({ consentFingerprint: "fp-1", latch: { suspended: true, stopEpoch: 3 } }),
    ensure: async (caller) => {
      ensured.push(caller)
      return { kind: "ensured", endpoint: "/run/engine.sock", capability: "ab".repeat(32), generation: 2 }
    },
  })
  try {
    return await run(ensured)
  } finally {
    await server.close()
  }
}

describe("the host's local API", () => {
  it("answers hand.status with the consent fingerprint and the latch, the reply a host-less engine reads", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async () => {
      expect(await callHostApi({ kind: "socket", path }, "hand.status", {})).toMatchObject({
        result: { consentFingerprint: "fp-1", latch: { suspended: true, stopEpoch: 3 } },
      })
    })
  })

  it("hand.ensure takes the caller's pid and process start and answers the endpoint, capability and generation", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async (ensured) => {
      const reply = await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: 4242, processStart: 77 })
      expect(reply).toMatchObject({ result: { kind: "ensured", endpoint: "/run/engine.sock", generation: 2 } })
      expect(ensured).toEqual([{ pid: 4242, processStart: 77 }])
    })
  })

  it("refuses unknown methods and malformed params without calling a handler", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async (ensured) => {
      expect(await callHostApi({ kind: "socket", path }, "hand.resume", {})).toMatchObject({
        error: { code: -32601, data: { reason: "unknown" } },
      })
      expect(await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: "4242" })).toMatchObject({
        error: { code: -32602 },
      })
      expect(await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: -1, processStart: 1 })).toMatchObject({
        error: { code: -32602 },
      })
      expect(ensured).toEqual([])
    })
  })

  it.runIf(process.platform === "linux")("binds a Linux abstract name, which no file can squat or unlink", async () => {
    const address: HostAddress = { kind: "abstract", name: `omo-host-api-test-${process.pid}-${Date.now()}` }
    await withServer(address, async () => {
      expect(await callHostApi(address, "hand.status", {})).toMatchObject({ result: { consentFingerprint: "fp-1" } })
    })
  })
})
