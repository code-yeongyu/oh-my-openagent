import { describe, expect, test } from "bun:test"

import { createConsentGatedFetch } from "./consent-gated-fetch"
import { createDefaultPostHogTransport } from "./posthog-client"

async function withEndpoint(run: (url: string, posts: () => number) => Promise<void>): Promise<void> {
  let posts = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      await request.arrayBuffer()
      posts += 1
      return Response.json({ status: 1 })
    },
  })
  try {
    await run(`http://127.0.0.1:${server.port}`, () => posts)
  } finally {
    await server.stop(true)
  }
}

function transportFor(url: string, isSendAllowed: () => boolean, dropped: number[]) {
  return createDefaultPostHogTransport("test-api-key", {
    host: url,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    strictLocalEvaluation: true,
    disableRemoteConfig: true,
    flushAt: 20,
    flushInterval: 10_000,
    fetch: createConsentGatedFetch({ isSendAllowed, onDropped: (count) => dropped.push(count) }),
  })
}

describe("createConsentGatedFetch", () => {
  test("#given consent #when the real SDK flushes its queue #then the batch reaches the endpoint", async () => {
    await withEndpoint(async (url, posts) => {
      // given
      const dropped: number[] = []
      const transport = transportFor(url, () => true, dropped)
      transport.capture({ distinctId: "d", event: "kept" })

      // when
      await transport.flush?.()
      await transport.shutdown()

      // then
      expect(posts()).toBe(1)
      expect(dropped).toEqual([])
    })
  })

  test("#given events queued while consented #when consent is gone at flush and at shutdown #then nothing is posted and the drop is counted once", async () => {
    await withEndpoint(async (url, posts) => {
      // given
      let consent = true
      const dropped: number[] = []
      const transport = transportFor(url, () => consent, dropped)
      transport.capture({ distinctId: "d", event: "first" })
      transport.capture({ distinctId: "d", event: "second" })
      transport.capture({ distinctId: "d", event: "third" })

      // when
      consent = false
      await transport.flush?.()
      consent = true
      await transport.shutdown()

      // then
      expect(posts()).toBe(0)
      expect(dropped).toEqual([3])
    })
  })

  test("#given a dropped batch whose body throws a non-Error while counted #when the gate drops it #then the SDK is still told it was accepted", async () => {
    // given
    class UnreadableBody extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject("unreadable")
      }
    }
    const dropped: number[] = []
    const gated = createConsentGatedFetch({ isSendAllowed: () => false, onDropped: (count) => dropped.push(count) })

    // when
    const response = await gated("http://127.0.0.1:9/batch", { method: "POST", headers: {}, body: new UnreadableBody(["x"]) })

    // then
    expect(response.status).toBe(200)
    expect(dropped).toEqual([0])
  })
})
