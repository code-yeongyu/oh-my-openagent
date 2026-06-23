/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"

const LIVE = process.env.PROBE_LAB_LIVE_HTTP === "1"

describe.skipIf(!LIVE)("replay engine drivers — live HTTP (gated by PROBE_LAB_LIVE_HTTP=1)", () => {
  afterAll(async () => {
    const curl = await import("./replay-engine-curl-cffi-driver").catch(() => null)
    if (curl) await curl.shutdownCurlCffiDriver()
    const cam = await import("./replay-engine-camoufox-driver").catch(() => null)
    if (cam) await cam.shutdownCamoufoxDriver()
  })

  test("curl_cffi driver against tls.peet.ws #given chrome 146 JA3 #when GET fired #then returns ja3_hash + ja4 fields", async () => {
    const { createCurlCffiDriver } = await import("./replay-engine-curl-cffi-driver")
    const driver = createCurlCffiDriver()
    const res = await driver({ url: "https://tls.peet.ws/api/all", method: "GET", headers: {}, body: null })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { tls?: { ja3_hash?: string; ja4?: string } }
    expect(body.tls?.ja3_hash).toBeDefined()
    expect(body.tls?.ja3_hash?.length).toBeGreaterThan(0)
    expect(body.tls?.ja4).toBeDefined()
    expect(body.tls?.ja4?.length).toBeGreaterThan(0)
  }, 60_000)

  test("camoufox driver against example.com #given navigate #when GET fired #then returns 200 with Example Domain body", async () => {
    const { createCamoufoxDriver } = await import("./replay-engine-camoufox-driver")
    const driver = createCamoufoxDriver()
    const res = await driver({ url: "https://example.com", method: "GET", headers: {}, body: null })
    expect(res.status).toBe(200)
    expect(res.body).toContain("Example Domain")
  }, 120_000)
})
