/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { startMockServer, type MockServer } from "../../features/probe-lab/providers/mock-server"
import { createProbeProviderHealthTool } from "./probe-provider-health-tool"

let tmpDir: string
let server: MockServer | null = null

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-health-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  server?.close()
  server = null
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe_provider_health", () => {
  test("health #given a registered ds2api provider with mock-server health URL #when health called #then ok=true and degraded_providers=0", async () => {
    server = startMockServer((req) => {
      if (req.headers.get("authorization") !== "Bearer tok-1") {
        return new Response("noauth", { status: 401 })
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 })
    })
    const ctx = makeCtx()
    ctx.store.insertProvider({
      id: "p-1",
      name: "ds2api-test",
      provider_type: "ds2api",
      base_url: server.url,
      auth_type: "bearer_token",
      auth_config: { bearer_token: "tok-1" },
      health_check_url: `${server.url}/v1/models`,
    })
    const tool = createProbeProviderHealthTool(ctx)
    const resp = await tool.execute({ force_check: false }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { providers: Array<{ ok: boolean; status_code: number | null }>; total_providers: number; degraded_providers: number }
    expect(parsed.total_providers).toBe(1)
    expect(parsed.providers[0]?.ok).toBe(true)
    expect(parsed.providers[0]?.status_code).toBe(200)
    expect(parsed.degraded_providers).toBe(0)
    ctx.store.close()
  })
})
