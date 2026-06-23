import { describe, expect, test } from "bun:test"
import type { ProbeProvider, ProbeRequest, ProbeResponse } from "../providers/provider-types"
import { uploadDeepSeekImage } from "./deepseek-file-upload"

type DispatchSink = (req: ProbeRequest) => Promise<ProbeResponse>

function buildProvider(dispatch: DispatchSink, calls: ProbeRequest[]): ProbeProvider {
  return {
    id: "test-provider",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "stub", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "stub" }),
    rotateCredentials: async () => ({ success: true, rotation_type: "stub" }),
    dispatchProbe: async (req) => {
      calls.push(req)
      return await dispatch(req)
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

function jsonResponse(payload: unknown): ProbeResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify(payload),
    timing: { total_ms: 1 },
    identity_used: null,
    fingerprint_used: null,
    retry_count: 0,
  }
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

describe("uploadDeepSeekImage", () => {
  describe("#given upload returns SUCCESS quickly with visionModel=false", () => {
    test("#when uploaded #then returns the file id; first request body is binary multipart; no x-model-type header", async () => {
      const calls: ProbeRequest[] = []
      const provider = buildProvider(async (req) => {
        if (req.url.endsWith("/api/v0/file/upload_file")) {
          return jsonResponse({ data: { biz_data: { id: "file-aaa", status: "PENDING" } }, biz_code: 0 })
        }
        if (req.url.includes("/api/v0/file/fetch_files")) {
          return jsonResponse({ data: { biz_data: { files: [{ id: "file-aaa", status: "SUCCESS" }] } } })
        }
        throw new Error(`unexpected url ${req.url}`)
      }, calls)

      const result = await uploadDeepSeekImage({
        provider,
        baseUrl: "https://chat.deepseek.com",
        imageData: TINY_PNG,
        filename: "image-1.png",
        mimeType: "image/png",
        requestId: "rid-1",
        visionModel: false,
        pollIntervalMs: 1,
      })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.fileId).toBe("file-aaa")
      expect(calls.length).toBe(2)
      const upload = calls[0]!
      expect(upload.method).toBe("POST")
      expect(upload.headers["Content-Type"] ?? "").toMatch(/^multipart\/form-data; boundary=/)
      expect(upload.body).toBeInstanceOf(Uint8Array)
      const bodyText = new TextDecoder("latin1").decode(upload.body as Uint8Array)
      expect(bodyText).toContain('name="file"')
      expect(bodyText).toContain('filename="image-1.png"')
      expect(bodyText).toContain("Content-Type: image/png")
      expect(upload.headers["x-model-type"]).toBeUndefined()
    })
  })

  describe("#given visionModel=true and ready upload", () => {
    test("#when uploaded #then x-model-type:vision header is set on upload; no fork is called; original file id returned", async () => {
      const calls: ProbeRequest[] = []
      const provider = buildProvider(async (req) => {
        if (req.url.endsWith("/api/v0/file/upload_file")) {
          return jsonResponse({ data: { biz_data: { id: "file-bbb", status: "PENDING" } }, biz_code: 0 })
        }
        if (req.url.includes("/api/v0/file/fetch_files")) {
          return jsonResponse({ data: { biz_data: { files: [{ id: "file-bbb", status: "SUCCESS" }] } } })
        }
        throw new Error(`unexpected url ${req.url}`)
      }, calls)

      const result = await uploadDeepSeekImage({
        provider,
        baseUrl: "https://chat.deepseek.com",
        imageData: TINY_PNG,
        filename: "v.png",
        mimeType: "image/png",
        requestId: "rid-2",
        visionModel: true,
        pollIntervalMs: 1,
      })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.fileId).toBe("file-bbb")
      expect(calls.length).toBe(2)
      const upload = calls[0]!
      expect(upload.headers["x-model-type"]).toBe("vision")
    })
  })

  describe("#given upload HTTP fails", () => {
    test("#when upload returns 500 #then result is not ok with HTTP-coded reason", async () => {
      const calls: ProbeRequest[] = []
      const provider = buildProvider(async () => ({
        status: 500, headers: {}, body: "boom", timing: { total_ms: 0 },
        identity_used: null, fingerprint_used: null, retry_count: 0,
      }), calls)

      const result = await uploadDeepSeekImage({
        provider,
        baseUrl: "https://chat.deepseek.com",
        imageData: TINY_PNG,
        filename: "x.png",
        mimeType: "image/png",
        requestId: "rid-err",
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/HTTP 500/)
    })
  })

  describe("#given polling reports FAILED", () => {
    test("#when fetch_files returns FAILED #then upload is rejected with that reason", async () => {
      const calls: ProbeRequest[] = []
      const provider = buildProvider(async (req) => {
        if (req.url.endsWith("/api/v0/file/upload_file")) {
          return jsonResponse({ data: { biz_data: { id: "file-failed", status: "PENDING" } }, biz_code: 0 })
        }
        if (req.url.includes("/api/v0/file/fetch_files")) {
          return jsonResponse({ data: { biz_data: { files: [{ id: "file-failed", status: "FAILED" }] } } })
        }
        throw new Error(`unexpected url ${req.url}`)
      }, calls)

      const result = await uploadDeepSeekImage({
        provider,
        baseUrl: "https://chat.deepseek.com",
        imageData: TINY_PNG,
        filename: "f.png",
        mimeType: "image/png",
        requestId: "rid-failed",
        pollIntervalMs: 1,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/FAILED/)
    })
  })

  describe("#given polling reports CONTENT_EMPTY", () => {
    test("#when fetch_files returns CONTENT_EMPTY #then upload is rejected as terminal failure", async () => {
      const calls: ProbeRequest[] = []
      const provider = buildProvider(async (req) => {
        if (req.url.endsWith("/api/v0/file/upload_file")) {
          return jsonResponse({ data: { biz_data: { id: "file-empty", status: "PENDING" } }, biz_code: 0 })
        }
        if (req.url.includes("/api/v0/file/fetch_files")) {
          return jsonResponse({ data: { biz_data: { files: [{ id: "file-empty", status: "CONTENT_EMPTY" }] } } })
        }
        throw new Error(`unexpected url ${req.url}`)
      }, calls)

      const result = await uploadDeepSeekImage({
        provider,
        baseUrl: "https://chat.deepseek.com",
        imageData: TINY_PNG,
        filename: "e.png",
        mimeType: "image/png",
        requestId: "rid-empty",
        pollIntervalMs: 1,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/CONTENT_EMPTY/)
    })
  })
})
