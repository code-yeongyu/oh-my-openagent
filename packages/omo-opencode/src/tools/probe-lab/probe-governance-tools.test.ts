/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeAuditLogTool } from "./probe-audit-log-tool"
import { createProbeExportTool } from "./probe-export-tool"
import { createProbeReplayTool } from "./probe-replay-tool"
import { createProbeProviderRotateTool } from "./probe-provider-rotate-tool"
import { createProbePoolBurnBudgetTool } from "./probe-pool-burn-budget-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-governance-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe-lab governance tools", () => {
  test("probe_audit_log #given audit entries #when queried #then returns filtered page", async () => {
    const ctx = makeCtx()
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-1", action: "rotate" })
    const tool = createProbeAuditLogTool(ctx)
    const resp = await tool.execute({ entity_type: "provider", action: "rotate", limit: 10, offset: 0 }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { total_count: number; entries: Array<{ action: string }> }
    expect(parsed.total_count).toBe(1)
    expect(parsed.entries[0]?.action).toBe("rotate")
    ctx.store.close()
  })

  test("probe_export #given credential headers #when jsonl exported #then credentials are redacted", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-export", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({
      session_id: "s-export",
      method: "GET",
      url: "https://example.test/export",
      request_headers: { Authorization: "Bearer secret" },
      response_status: 200,
      response_body: "ok",
    })
    const tool = createProbeExportTool(ctx)
    const resp = await tool.execute({ session_id: "s-export", format: "jsonl", anonymize_credentials: true }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { file_path: string; exchange_count: number }
    expect(parsed.exchange_count).toBe(1)
    expect(existsSync(parsed.file_path)).toBe(true)
    const content = readFileSync(parsed.file_path, "utf8")
    expect(content).toContain("REDACTED")
    expect(content).not.toContain("secret")
    ctx.store.close()
  })

  test("probe_replay #given stored exchange #when strip_cif applied #then replay persists new exchange", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => new Response(await req.text(), { status: 201, headers: { "content-type": "application/json" } }),
    })
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-replay", hypothesis_id: null, identity_id: null })
    const original = ctx.store.insertExchange({
      session_id: "s-replay",
      method: "POST",
      url: server.url.toString(),
      request_headers: { Authorization: "Bearer original", "X-Keep": "1" },
      request_body: JSON.stringify({ message: "hello", cif: "remove" }),
      response_status: 200,
    })
    const tool = createProbeReplayTool(ctx)
    const resp = await tool.execute({
      exchange_id: original.id,
      modify: { headers_remove: ["Authorization"], body_transform: "strip_cif" },
    }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { exchange_id: number; status: number }
    expect(parsed.exchange_id).not.toBe(original.id)
    expect(parsed.status).toBe(201)
    expect(String(ctx.store.getExchange(parsed.exchange_id)?.response_body)).toBe(JSON.stringify({ message: "hello" }))
    server.stop(true)
    ctx.store.close()
  })

  test("probe_replay kill switch #given global kill switch is active #when replay is called #then dispatch is rejected", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test stop")
    ctx.store.insertSession({ id: "s-replay-kill", hypothesis_id: null, identity_id: null })
    const original = ctx.store.insertExchange({ session_id: "s-replay-kill", method: "POST", url: "http://localhost:1", response_status: 200 })
    const resp = await createProbeReplayTool(ctx).execute({ exchange_id: original.id }, { sessionID: "test" } as never)
    expect(resp as string).toBe("[ERROR] global_kill_switch is active; probe_replay rejected. Disable via probe_lab_config to resume.")
    expect(ctx.store.countExchangesForSession("s-replay-kill")).toBe(1)
    ctx.store.close()
  })

  test("probe_replay evidence linkage #given source evidence exists #when replay persists outcome #then new evidence links to the source evidence", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("replayed", { status: 202 }) })
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-replay", text: "claim", falsifiability_criteria: "criteria" })
    ctx.store.insertSession({ id: "s-replay-link", hypothesis_id: "h-replay", identity_id: null })
    const original = ctx.store.insertExchange({ session_id: "s-replay-link", method: "GET", url: server.url.toString(), response_status: 200 })
    const sourceEvidence = ctx.store.insertEvidence({ hypothesis_id: "h-replay", session_id: "s-replay-link", exchange_id: original.id, verdict: "supports" })
    const resp = await createProbeReplayTool(ctx).execute({ exchange_id: original.id }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { exchange_id: number }
    const db = new Database(join(tmpDir, "lab.db"))
    const linked = db.query<{ previous_evidence_id: number | null }, [number]>(
      "SELECT previous_evidence_id FROM evidence WHERE exchange_id = ?1",
    ).get(parsed.exchange_id)
    expect(linked?.previous_evidence_id).toBe(sourceEvidence.id)
    db.close()
    server.stop(true)
    ctx.store.close()
  })

  test("probe_provider_rotate #given provider #when api key rotation requested #then auth config changes", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({ id: "p-rotate", name: "rotate", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "old" } })
    const tool = createProbeProviderRotateTool(ctx)
    const resp = await tool.execute({ provider_id: "p-rotate", rotation_type: "api_key", reason: "test" }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { new_value_hash: string }
    expect(parsed.new_value_hash.length).toBeGreaterThan(10)
    expect(JSON.parse(ctx.store.getProvider("p-rotate")!.auth_config).bearer_token).not.toBe("old")
    ctx.store.close()
  })

  test("probe_pool_burn_budget #given quarantine audit rows #when day budget queried #then remaining budget is computed", async () => {
    const ctx = makeCtx()
    ctx.store.insertAuditLog({ entity_type: "identity", entity_id: "id-1", action: "quarantine" })
    const tool = createProbePoolBurnBudgetTool(ctx)
    const resp = await tool.execute({ scope: "day" }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { budget_total: number; identities_burned: number; budget_remaining: number }
    expect(parsed.budget_total).toBe(20)
    expect(parsed.identities_burned).toBe(1)
    expect(parsed.budget_remaining).toBe(19)
    ctx.store.close()
  })
})
