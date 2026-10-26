import { describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { R2UploadError } from "./r2-signed-put"
import { createR2Store } from "./r2-store"

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex")

describe("R2 prefix deletes", () => {
  const credentials = { accountId: "dummy", accessKeyId: "test-access-key", secretAccessKey: "test-secret-key", bucket: "omo-releases" }
  const scratchKey = "dry-run/delete/releases/v5.1.48/omo-linux-x64-baseline"
  const badGateway = () => new Response(`<html><title>502 Bad Gateway</title> ${credentials.secretAccessKey}</html>`, { status: 502, headers: { "cf-ray": "ray-502" } })
  const internalError = () => new Response(
    "<Error><Code>InternalError</Code><Message>We encountered an internal error. Please try again.</Message></Error>",
    { status: 500, headers: { "x-amz-request-id": "request-500", "cf-ray": "ray-500" } },
  )

  function stubBunClient() {
    // The Bun S3 client must not carry the DELETE; if it does, it fails the way R2 failed the dry-run probe.
    const list = spyOn(Bun.S3Client.prototype, "list").mockResolvedValue({ contents: [{ key: scratchKey }], isTruncated: false } as Awaited<ReturnType<Bun.S3Client["list"]>>)
    const remove = spyOn(Bun.S3Client.prototype, "delete").mockRejectedValue(Object.assign(new Error("We encountered an internal error. Please try again."), { name: "S3Error", code: "InternalError" }))
    return { list, remove }
  }

  test("retries a failed DELETE through the signed transport and succeeds", async () => {
    // given
    const bun = stubBunClient()
    const fetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(badGateway()).mockResolvedValueOnce(internalError()).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined)
    const log = spyOn(console, "log").mockImplementation(() => {})
    try {
      // when
      await createR2Store(credentials, "dry-run/delete/").deletePrefix("")
      // then
      expect(bun.remove.mock.calls).toHaveLength(0)
      expect(fetch.mock.calls).toHaveLength(3)
      expect(sleep.mock.calls).toHaveLength(2)
      for (const [url, init] of fetch.mock.calls) {
        const headers = new Headers(init?.headers)
        expect(url).toBe(`https://dummy.r2.cloudflarestorage.com/omo-releases/${scratchKey}`)
        expect(init?.method).toBe("DELETE")
        expect(init?.body ?? null).toBeNull()
        expect(headers.get("x-amz-content-sha256")).toBe(EMPTY_SHA256)
        expect(headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=test-access-key/")
        expect(headers.get("authorization")).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date,")
      }
      const retries = log.mock.calls.map((call) => String(call[0])).join("\n")
      expect(retries).toContain("HTTP 502")
      expect(retries).toContain("ray-502")
      expect(retries).toContain("502 Bad Gateway")
      expect(retries).toContain("HTTP 500 InternalError")
      expect(retries).toContain("request-500")
      expect(retries).not.toContain(credentials.secretAccessKey)
    } finally {
      bun.list.mockRestore()
      bun.remove.mockRestore()
      fetch.mockRestore()
      sleep.mockRestore()
      log.mockRestore()
    }
  })

  test("reports status, code, request id, cf-ray and body when every DELETE attempt fails", async () => {
    // given
    const bun = stubBunClient()
    const fetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(badGateway()).mockResolvedValueOnce(internalError()).mockResolvedValueOnce(internalError())
    const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined)
    const log = spyOn(console, "log").mockImplementation(() => {})
    try {
      // when
      const failure = await createR2Store(credentials, "dry-run/delete/").deletePrefix("").then(() => null, (error: unknown) => error)
      // then
      expect(bun.remove.mock.calls).toHaveLength(0)
      expect(fetch.mock.calls).toHaveLength(3)
      expect(failure).toBeInstanceOf(R2UploadError)
      expect(failure).toMatchObject({ status: 500, code: "InternalError", requestId: "request-500", cfRay: "ray-500" })
      const message = String(failure)
      expect(message).toContain(`DELETE ${scratchKey}`)
      expect(message).toContain("We encountered an internal error")
      expect(message).toContain("cfRay=ray-500")
      expect(message).not.toContain(credentials.secretAccessKey)
      expect(message).not.toContain(credentials.accessKeyId)
    } finally {
      bun.list.mockRestore()
      bun.remove.mockRestore()
      fetch.mockRestore()
      sleep.mockRestore()
      log.mockRestore()
    }
  })
})

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
