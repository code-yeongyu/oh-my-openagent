/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeAlertsEvaluateTool } from "./probe-alerts-evaluate-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-alerts-v10-"))
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

function seedAllNineRules(ctx: ReturnType<typeof makeCtx>): void {
  ctx.store.setProbeLabConfig("global_kill_switch", "1", "test")
  ctx.store.upsertIdentity({ id: "i-q1", kind: "api_key", config: {}, status: "quarantined", provider_id: "prov-x" })
  ctx.store.upsertIdentity({ id: "i-q2", kind: "api_key", config: {}, status: "quarantined", provider_id: "prov-x" })
  ctx.store.upsertIdentity({ id: "i-a1", kind: "api_key", config: {}, status: "active", provider_id: "prov-x" })
  ctx.store.upsertIdentity({ id: "i-q3", kind: "api_key", config: {}, status: "quarantined", provider_id: "prov-y" })
  ctx.store.upsertIdentity({ id: "i-a2", kind: "api_key", config: {}, status: "active", provider_id: "prov-y" })
  ctx.store.upsertIdentity({ id: "i-a3", kind: "api_key", config: {}, status: "active", provider_id: "prov-y" })
  ctx.store.upsertIdentity({ id: "i-a4", kind: "api_key", config: {}, status: "active", provider_id: "prov-y" })
  ctx.store.upsertIdentity({ id: "i-a5", kind: "api_key", config: {}, status: "active", provider_id: "prov-y" })
  ctx.store.setIdentityCircuitState({ id: "i-q1", state: "open", consecutiveFailures: 5, lastFailureAt: Math.floor(Date.now() / 1000), quarantinedUntil: null })
  ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
  ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
  ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
  ctx.store.upsertIdentity({ id: "id-canary", kind: "api_key", config: {}, status: "active", tier: "canary" })
  ctx.store.insertCanaryLock({ identity_id: "id-canary", locked_by: "test", lock_reason: "watch", canary_test_url: "http://probe/canary" })
  ctx.store.recordCanaryResult("id-canary", "fail")
  const expiresSoon = Math.floor(Date.now() / 1000) + 600
  ctx.store.insertProvider({
    id: "p-exp",
    name: "expires-soon",
    provider_type: "ds2api",
    base_url: "http://localhost:1",
    auth_type: "bearer_token",
    auth_config: { bearer_token: "x", expires_at: String(expiresSoon) },
  })
  ctx.store.insertHypothesis({ id: "h-sb", text: "claim", falsifiability_criteria: "c" })
  ctx.store.insertExperiment({ id: "e-breach", hypothesis_id: "h-sb", name: "breached", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 60, require_canary: false } })
  ctx.store.insertAuditLog({ entity_type: "experiment", entity_id: "e-breach", action: "abort_safety", reason: "budget exceeded" })
  for (let i = 0; i < 80; i++) {
    ctx.store.upsertIdentity({ id: `i-burn-${i}`, kind: "api_key", config: {}, status: "exhausted", provider_id: "prov-burn" })
  }
}

describe("probe-lab v1.0 alert matrix end-to-end", () => {
  test("probe_alerts_evaluate #given seeds for all 9 rules in one DB #when called once #then alerts contain at least one alert per rule kind", async () => {
    const ctx = makeCtx()
    seedAllNineRules(ctx)
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string }> }
    const rules = new Set(parsed.alerts.map((a) => a.rule))
    expect(rules.has("kill_switch_active")).toBe(true)
    expect(rules.has("provider_down")).toBe(true)
    expect(rules.has("canary_failure")).toBe(true)
    expect(rules.has("credential_expiry")).toBe(true)
    expect(rules.has("experiment_safety_breach")).toBe(true)
    expect(rules.has("pool_critical") || rules.has("pool_degraded")).toBe(true)
    ctx.store.close()
  })

  test("probe_alerts_evaluate prometheus format #given seeded rules #when called #then output is gauge format with rule labels", async () => {
    const ctx = makeCtx()
    seedAllNineRules(ctx)
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "prometheus" }, { sessionID: "t" } as never)
    expect(resp as string).toContain("# TYPE probe_alert_active gauge")
    expect(resp as string).toContain("probe_alert_active{rule=\"kill_switch_active\"")
    ctx.store.close()
  })
})

describe("probe-lab v1.0 alert dedup", () => {
  test("probe_alerts_evaluate #given same rule fires twice within 1h #when called #then second call suppresses the dedup'd alert", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test")
    const first = JSON.parse(await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never) as string) as { alerts: Array<{ rule: string }>; suppressed: Array<{ rule: string }> }
    expect(first.alerts.find((a) => a.rule === "kill_switch_active")).toBeDefined()
    expect(first.suppressed.length).toBe(0)
    const second = JSON.parse(await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never) as string) as { alerts: Array<{ rule: string }>; suppressed: Array<{ rule: string }> }
    expect(second.alerts.find((a) => a.rule === "kill_switch_active")).toBeUndefined()
    expect(second.suppressed.find((a) => a.rule === "kill_switch_active")).toBeDefined()
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given history for one rule #when other rules fire #then non-deduped rules pass through", async () => {
    const ctx = makeCtx()
    ctx.store.recordAlertHistory({ rule_name: "kill_switch_active", severity: "INFO", message: "old", entity_id: null })
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test")
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-fresh", action: "health_fail" })
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-fresh", action: "health_fail" })
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-fresh", action: "health_fail" })
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }>; suppressed: Array<{ rule: string }> }
    expect(parsed.suppressed.find((a) => a.rule === "kill_switch_active")).toBeDefined()
    expect(parsed.alerts.find((a) => a.rule === "provider_down" && a.entity_id === "p-fresh")).toBeDefined()
    ctx.store.close()
  })
})
