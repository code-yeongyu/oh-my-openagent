/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeRetentionRunTool } from "./probe-retention-run-tool"

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-retention-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(dbPath)
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

function backdateExchanges(daysAgo: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86_400
  const db = new Database(dbPath)
  db.run("UPDATE probe_exchanges SET timestamp = ?1", [cutoff])
  db.close()
}

function backdateAuditLog(daysAgo: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86_400
  const db = new Database(dbPath)
  db.run("UPDATE audit_log SET created_at = ?1", [cutoff])
  db.close()
}

function backdateCaptures(daysAgo: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86_400
  const db = new Database(dbPath)
  db.run("UPDATE captures SET created_at = ?1", [cutoff])
  db.close()
}

function backdateRateLimit(daysAgo: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86_400
  const db = new Database(dbPath)
  db.run("UPDATE rate_limit_observations SET timestamp = ?1", [cutoff])
  db.close()
}

describe("probe-lab v1.0 retention sweeper", () => {
  test("probe_retention_run dry_run=true #given expired rows #when called #then returns counts without mutating", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-r", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({ session_id: "s-r", method: "GET", url: "http://x", response_body: "old body", response_status: 200 })
    ctx.store.insertAuditLog({ entity_type: "test", entity_id: "x", action: "noop" })
    ctx.store.close()
    backdateExchanges(120)
    backdateAuditLog(400)
    const ctx2 = makeCtx()
    const resp = await createProbeRetentionRunTool(ctx2).execute({ dry_run: true }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { dry_run: boolean; would_have_done: { exchanges_blanked: number; audit_rows_deleted: number } }
    expect(parsed.dry_run).toBe(true)
    expect(parsed.would_have_done.exchanges_blanked).toBe(1)
    expect(parsed.would_have_done.audit_rows_deleted).toBe(1)
    expect(ctx2.store.countAuditLog({})).toBe(1)
    ctx2.store.close()
  })

  test("probe_retention_run dry_run=false #given expired rows #when called #then mutates and records last_run_at", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-r2", hypothesis_id: null, identity_id: null })
    const ex = ctx.store.insertExchange({ session_id: "s-r2", method: "GET", url: "http://x", response_body: "old body", response_status: 200 })
    ctx.store.insertAuditLog({ entity_type: "test", entity_id: "y", action: "noop" })
    ctx.store.insertRateLimitObservation({ identity_id: null, provider_id: null, type: "hard_429" })
    ctx.store.close()
    backdateExchanges(120)
    backdateAuditLog(400)
    backdateRateLimit(40)
    const ctx2 = makeCtx()
    const resp = await createProbeRetentionRunTool(ctx2).execute({ dry_run: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { dry_run: boolean; swept: { exchanges_blanked: number; audit_rows_deleted: number; rate_limits_deleted: number } }
    expect(parsed.dry_run).toBe(false)
    expect(parsed.swept.exchanges_blanked).toBeGreaterThanOrEqual(1)
    expect(parsed.swept.audit_rows_deleted).toBeGreaterThanOrEqual(1)
    expect(parsed.swept.rate_limits_deleted).toBeGreaterThanOrEqual(1)
    const after = ctx2.store.getExchange(ex.id)
    expect(after?.response_body).toBeNull()
    const lastRun = ctx2.store.getProbeLabConfig("retention_last_run_at")
    expect(lastRun?.value).toBeDefined()
    ctx2.store.close()
  })

  test("probe_retention_run dry_run=false #given fresh data only #when called #then sweeps zero rows", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-fresh", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({ session_id: "s-fresh", method: "GET", url: "http://x", response_body: "fresh", response_status: 200 })
    const resp = await createProbeRetentionRunTool(ctx).execute({ dry_run: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { swept: { exchanges_blanked: number } }
    expect(parsed.swept.exchanges_blanked).toBe(0)
    ctx.store.close()
  })

  test("probe_retention_run #given captures older than 30d #when called #then captures are deleted", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-c", hypothesis_id: null, identity_id: null })
    ctx.store.insertCapture({ id: "cap-1", session_id: "s-c", format: "har", file_path: "/tmp/x.har" })
    ctx.store.close()
    backdateCaptures(40)
    const ctx2 = makeCtx()
    const resp = await createProbeRetentionRunTool(ctx2).execute({ dry_run: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { swept: { captures_deleted: number } }
    expect(parsed.swept.captures_deleted).toBe(1)
    expect(ctx2.store.getCapture("cap-1")).toBeNull()
    ctx2.store.close()
  })
})
