import { describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { createR2Store } from "./r2-store"

describe("R2 text object writes", () => {
  test.each([
    { key: "releases/v5.1.48/.complete", type: "application/json" },
    { key: "channels/latest", type: "text/plain" },
  ])("retries transient write failure for $key", async ({ key, type }) => {
    const fetch = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<Error><Code>InternalError</Code><Message>retry</Message></Error>", { status: 502 }))
      .mockResolvedValueOnce(new Response(null))
    const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined)
    const log = spyOn(console, "log").mockImplementation(() => {})
    try {
      const store = createR2Store({ accountId: "dummy", accessKeyId: "test-key", secretAccessKey: "test-secret", bucket: "omo-releases" }, "dry-run/retry/")
      await store.write(key, "5.1.48\n", type)
      expect(fetch.mock.calls).toHaveLength(2)
      expect(sleep.mock.calls).toHaveLength(1)
      const bodies = await Promise.all(fetch.mock.calls.map(async ([, init]) => {
        if (!(init?.body instanceof Blob)) throw new Error("expected replayable Blob")
        return init.body.text()
      }))
      expect(bodies).toEqual(["5.1.48\n", "5.1.48\n"])
    } finally {
      fetch.mockRestore()
      sleep.mockRestore()
      log.mockRestore()
    }
  })
  test("marker and pointer use signed fixed-length PUTs within the scratch prefix", async () => {
    // given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null))
    const store = createR2Store({ accountId: "dummy", accessKeyId: "test-key", secretAccessKey: "test-secret", bucket: "omo-releases" }, "dry-run/test/")
    const objects = [
      { key: "releases/v5.1.48/.complete", body: '{"version":"5.1.48"}', type: "application/json" },
      { key: "channels/latest", body: "5.1.48\n", type: "text/plain" },
    ]
    try {
      // when
      for (const object of objects) await store.write(object.key, object.body, object.type)
      // then
      expect(fetch.mock.calls).toHaveLength(2)
      for (const [index, object] of objects.entries()) {
        const request = fetch.mock.calls[index]
        if (!request) throw new Error(`missing request ${index}`)
        const [url, init] = request
        const headers = new Headers(init?.headers)
        expect(url).toBe(`https://dummy.r2.cloudflarestorage.com/omo-releases/dry-run/test/${object.key}`)
        expect(init?.method).toBe("PUT")
        if (!(init?.body instanceof Blob)) throw new Error("text object body must have a known byte length")
        expect(await init.body.text()).toBe(object.body)
        expect(headers.get("content-length")).toBe(String(Buffer.byteLength(object.body)))
        expect(headers.get("content-type")).toBe(object.type)
        expect(headers.get("x-amz-content-sha256")).toBe(createHash("sha256").update(object.body).digest("hex"))
        expect(headers.get("transfer-encoding")).toBeNull()
        expect(headers.get("content-encoding")).toBeNull()
        expect(headers.get("x-amz-sdk-checksum-algorithm")).toBeNull()
        expect(headers.get("if-match")).toBeNull()
        expect(headers.get("if-none-match")).toBeNull()
      }
    } finally {
      fetch.mockRestore()
    }
  })
})
