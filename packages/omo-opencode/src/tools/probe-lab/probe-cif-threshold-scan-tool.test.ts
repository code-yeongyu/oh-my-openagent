/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { startMockServer, type MockServer } from "../../features/probe-lab/providers/mock-server"
import { createProbeCifThresholdScanTool } from "./probe-cif-threshold-scan-tool"

let tmpDir: string
let server: MockServer | null = null

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-cif-tool-")) })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); server?.close(); server = null })

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

const FINISHED_BODY = [
  "event: ready",
  `data: {"v":{"response":{"status":"WIP"}}}`,
  `data: {"p":"response/content","o":"APPEND","v":"hi"}`,
  `data: {"p":"response/accumulated_token_usage","o":"SET","v":3}`,
  `data: {"p":"response/status","v":"FINISHED"}`,
].join("\n")

describe("probe_cif_threshold_scan tool", () => {
  test("missing provider #given unknown provider_id #when scan invoked #then returns ERROR string", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    const t = createProbeCifThresholdScanTool(ctx)
    const resp = await t.execute(
      { provider_id: "missing", hypothesis_id: "h", sizes: [100], pace_ms: 0, fresh_session_per_probe: true },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("[ERROR] probe_cif_threshold_scan failed")
    ctx.store.close()
  })

  test("kill switch #given global_kill_switch active #when scan invoked #then rejected before dispatch", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "true", "stop")
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    const t = createProbeCifThresholdScanTool(ctx)
    const resp = await t.execute(
      { provider_id: "p", hypothesis_id: "h", sizes: [100], pace_ms: 0, fresh_session_per_probe: true },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("global_kill_switch is active")
    ctx.store.close()
  })

  test("ds2api roundtrip #given a registered ds2api provider hitting a mock /chat/completion #when sizes=[50] #then exchange recorded with FINISHED status", async () => {
    server = startMockServer((req) => {
      const url = new URL(req.url)
      if (url.pathname === "/api/v0/chat_session/create") {
        return new Response(JSON.stringify({ data: { biz_data: { id: "chat-x" } } }), { status: 200, headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/api/v0/chat/completion") {
        return new Response(FINISHED_BODY, { status: 200, headers: { "content-type": "text/event-stream" } })
      }
      return new Response("not found", { status: 404 })
    })
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-mock", name: "mock-ds", provider_type: "ds2api",
      base_url: server.url, auth_type: "bearer_token", auth_config: { bearer_token: "t" },
    })
    const t = createProbeCifThresholdScanTool(ctx)
    const resp = await t.execute(
      { provider_id: "p-mock", hypothesis_id: "h", sizes: [50], pace_ms: 0, fresh_session_per_probe: true },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as {
      exchange_ids: number[]
      sizes_tested: number[]
      outcomes: Array<{ size: number; status: number; terminal_status: string | null; completed_normally: boolean; content_chars: number }>
    }
    expect(parsed.exchange_ids.length).toBe(1)
    expect(parsed.sizes_tested).toEqual([50])
    expect(parsed.outcomes[0].status).toBe(200)
    expect(parsed.outcomes[0].terminal_status).toBe("FINISHED")
    expect(parsed.outcomes[0].completed_normally).toBe(true)
    expect(parsed.outcomes[0].content_chars).toBeGreaterThan(0)
    ctx.store.close()
  })
})
