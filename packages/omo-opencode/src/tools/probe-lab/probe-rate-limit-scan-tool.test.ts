/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { startMockServer, type MockServer } from "../../features/probe-lab/providers/mock-server"
import { createProbeRateLimitScanTool } from "./probe-rate-limit-scan-tool"

let tmpDir: string
let server: MockServer | null = null

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-rate-tool-"))
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

const FINISHED_BODY = [
  "event: ready",
  `data: {"v":{"response":{"status":"WIP"}}}`,
  `data: {"p":"response/content","o":"APPEND","v":"hi"}`,
  `data: {"p":"response/accumulated_token_usage","o":"SET","v":3}`,
  `data: {"p":"response/status","v":"FINISHED"}`,
].join("\n")

function makeMockHandler(opts: { is_muted?: number } = {}) {
  return (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname === "/api/v0/users/current") {
      return new Response(
        JSON.stringify({ data: { biz_data: { chat: { is_muted: opts.is_muted ?? 0, mute_until: null } } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url.pathname === "/api/v0/chat_session/create") {
      return new Response(JSON.stringify({ data: { biz_data: { id: "chat-x" } } }), {
        status: 200, headers: { "content-type": "application/json" },
      })
    }
    if (url.pathname === "/api/v0/chat/completion") {
      return new Response(FINISHED_BODY, { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    return new Response("not found", { status: 404 })
  }
}

describe("probe_rate_limit_scan tool", () => {
  test("missing provider #given unknown provider_id #when scan invoked #then returns ERROR string", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    const t = createProbeRateLimitScanTool(ctx)
    const resp = await t.execute(
      {
        provider_id: "missing", hypothesis_id: "h", mode: "sustained",
        sustained: { req_per_min: 60, total_requests: 1 },
        mute_check_interval_ms: 1000, abort_on_mute: true,
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("[ERROR] probe_rate_limit_scan failed")
    ctx.store.close()
  })

  test("kill switch #given global_kill_switch active #when scan invoked #then rejected before dispatch", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "true", "stop")
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    const t = createProbeRateLimitScanTool(ctx)
    const resp = await t.execute(
      {
        provider_id: "p", hypothesis_id: "h", mode: "sustained",
        sustained: { req_per_min: 60, total_requests: 1 },
        mute_check_interval_ms: 1000, abort_on_mute: true,
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("global_kill_switch is active")
    ctx.store.close()
  })

  test("missing config #given mode=sustained without sustained config #when scan invoked #then ERROR", async () => {
    server = startMockServer(makeMockHandler())
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-mock", name: "mock-ds", provider_type: "ds2api",
      base_url: server.url, auth_type: "bearer_token", auth_config: { bearer_token: "t" },
    })
    const t = createProbeRateLimitScanTool(ctx)
    const resp = await t.execute(
      {
        provider_id: "p-mock", hypothesis_id: "h", mode: "sustained",
        mute_check_interval_ms: 1000, abort_on_mute: true,
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("missing sustained config")
    ctx.store.close()
  })

  test("sustained roundtrip #given mock server returning FINISHED #when 1 probe #then exchange recorded", async () => {
    server = startMockServer(makeMockHandler())
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-mock", name: "mock-ds", provider_type: "ds2api",
      base_url: server.url, auth_type: "bearer_token", auth_config: { bearer_token: "t" },
    })
    const t = createProbeRateLimitScanTool(ctx)
    const resp = await t.execute(
      {
        provider_id: "p-mock", hypothesis_id: "h", mode: "sustained",
        sustained: { req_per_min: 60, total_requests: 1, prompt_chars: 50 },
        mute_check_interval_ms: 1000, abort_on_mute: true,
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as {
      mode: string
      exchange_ids: number[]
      summary: { total_probes: number; succeeded: number }
      outcomes: Array<{ status: number; terminal_status: string | null; completed_normally: boolean }>
    }
    expect(parsed.mode).toBe("sustained")
    expect(parsed.exchange_ids.length).toBe(1)
    expect(parsed.summary.total_probes).toBe(1)
    expect(parsed.summary.succeeded).toBe(1)
    expect(parsed.outcomes[0].terminal_status).toBe("FINISHED")
    ctx.store.close()
  })

  test("recovery #given baseline poll only #when recovery mode #then samples returned", async () => {
    server = startMockServer(makeMockHandler({ is_muted: 0 }))
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-mock", name: "mock-ds", provider_type: "ds2api",
      base_url: server.url, auth_type: "bearer_token", auth_config: { bearer_token: "t" },
    })
    const t = createProbeRateLimitScanTool(ctx)
    const resp = await t.execute(
      {
        provider_id: "p-mock", hypothesis_id: "h", mode: "recovery",
        recovery: { checkpoints_seconds: [1] },
        mute_check_interval_ms: 1000, abort_on_mute: true,
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as {
      mode: string
      recovery_samples: Array<{ elapsed_seconds: number; is_muted: number }>
    }
    expect(parsed.mode).toBe("recovery")
    expect(parsed.recovery_samples.length).toBeGreaterThanOrEqual(1)
    expect(parsed.recovery_samples[0].is_muted).toBe(0)
    ctx.store.close()
  })
})
