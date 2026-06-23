/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  __setCamoufoxDriverForTest,
  __setCurlCffiDriverForTest,
  dispatchViaCamoufox,
  dispatchViaCurlCffi,
} from "./replay-engine-dispatcher"

let savedCamoufoxAuto: string | undefined
let savedCurlCffiAuto: string | undefined

beforeEach(() => {
  savedCamoufoxAuto = process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO
  savedCurlCffiAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
  delete process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO
  delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
})

afterEach(() => {
  __setCamoufoxDriverForTest(null)
  __setCurlCffiDriverForTest(null)
  if (savedCamoufoxAuto != null) process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO = savedCamoufoxAuto
  if (savedCurlCffiAuto != null) process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = savedCurlCffiAuto
})

describe("replay-engine-dispatcher production driver wiring", () => {
  test("camoufox engine #given no production driver registered #when dispatched #then throws structured production error directing to SKILL.md", async () => {
    __setCamoufoxDriverForTest(null)
    await expect(
      dispatchViaCamoufox({ url: "https://example.com", method: "GET", headers: {}, body: null }),
    ).rejects.toThrow(/requires a production driver registration/)
    await expect(
      dispatchViaCamoufox({ url: "https://example.com", method: "GET", headers: {}, body: null }),
    ).rejects.toThrow(/SKILL\.md/)
  })

  test("curl_cffi engine #given no production driver registered #when dispatched #then throws structured production error directing to SKILL.md", async () => {
    __setCurlCffiDriverForTest(null)
    await expect(
      dispatchViaCurlCffi({ url: "https://example.com", method: "GET", headers: {}, body: null }),
    ).rejects.toThrow(/requires a production driver registration/)
    await expect(
      dispatchViaCurlCffi({ url: "https://example.com", method: "GET", headers: {}, body: null }),
    ).rejects.toThrow(/__setCurlCffiDriverForTest/)
  })

  test("camoufox engine #given driver registered at runtime #when dispatched #then driver is invoked and result returned", async () => {
    const calls: Array<{ url: string }> = []
    __setCamoufoxDriverForTest(async (req) => {
      calls.push({ url: req.url })
      return { status: 200, headers: {}, body: "ok", timing_ms: 5 }
    })
    const result = await dispatchViaCamoufox({ url: "https://example.com/x", method: "GET", headers: {}, body: null })
    expect(result.status).toBe(200)
    expect(result.body).toBe("ok")
    expect(calls[0]?.url).toBe("https://example.com/x")
  })

  test("camoufox engine #given test driver explicitly set after env-var-gated default #when dispatched #then test driver wins (test seam preserved)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO
    process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO = "1"
    try {
      __setCamoufoxDriverForTest(async () => ({ status: 418, headers: {}, body: "teapot-via-test-seam", timing_ms: 1 }))
      const result = await dispatchViaCamoufox({ url: "https://example.com/x", method: "GET", headers: {}, body: null })
      expect(result.status).toBe(418)
      expect(result.body).toBe("teapot-via-test-seam")
    } finally {
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO
      else process.env.IDM_PROBE_LAB_CAMOUFOX_AUTO = previousAuto
    }
  })

  test("curl_cffi engine #given driver registered at runtime #when dispatched #then driver is invoked and result returned", async () => {
    const calls: Array<{ method: string }> = []
    __setCurlCffiDriverForTest(async (req) => {
      calls.push({ method: req.method })
      return { status: 200, headers: { "x-engine": "curl_cffi-stub" }, body: "{\"ok\":true}", timing_ms: 7 }
    })
    const result = await dispatchViaCurlCffi({ url: "https://example.com", method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    expect(result.status).toBe(200)
    expect(result.headers["x-engine"]).toBe("curl_cffi-stub")
    expect(calls[0]?.method).toBe("POST")
  })

  test("curl_cffi engine #given env-var auto-load enabled and no test driver #when dispatched #then bypasses production-error path (auto-load mechanism is engaged)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    try {
      __setCurlCffiDriverForTest(null)
      const outcome = await dispatchViaCurlCffi({ url: "https://invalid.localhost.probelab.test/", method: "GET", headers: {}, body: null }).then(
        (res) => ({ kind: "success" as const, res }),
        (err: Error) => ({ kind: "error" as const, message: err.message }),
      )
      if (outcome.kind === "error") {
        expect(outcome.message).not.toMatch(/requires a production driver registration/)
      } else {
        expect(outcome.res.status).toBeGreaterThanOrEqual(0)
      }
    } finally {
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      const { __resetCurlCffiDriverForTest } = await import("./replay-engine-curl-cffi-driver").catch(() => ({ __resetCurlCffiDriverForTest: () => undefined }))
      __resetCurlCffiDriverForTest()
      __setCurlCffiDriverForTest(null)
    }
  })
})
