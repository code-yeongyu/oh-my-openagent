/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __setReasoningCoreClientForTest as __setDeciderClientForTest } from "../../features/probe-lab/hypothesis-status-decider"
import { __setReasoningCoreClientForTest as __setFalsificationClientForTest } from "../../features/probe-lab/falsification-writer"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeAlertsEvaluateTool } from "./probe-alerts-evaluate-tool"
import { createProbeExperimentRunTool } from "./probe-experiment-run-tool"
import { createProbeHypothesisEvidenceTool } from "./probe-hypothesis-evidence-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-v05-gate6-"))
})

afterEach(() => {
  __setDeciderClientForTest(null)
  __setFalsificationClientForTest(null)
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

function unsupported(): never {
  throw new Error("mock client method should not be called")
}

describe("probe-lab v0.5 gate#6 — aspic_extensions_count persistence", () => {
  test("probe_hypothesis_evidence #given multi-extension preferred semantics #when evidence is recorded #then aspic_extensions_count is persisted", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({
      id: "h-mx",
      text: "multi-ext persistence",
      falsifiability_criteria: "any failing exchange",
      aspic_theory_template: { premises: [] },
    })
    const session = ctx.store.insertSession({ id: "s-mx", hypothesis_id: "h-mx", identity_id: null })
    const exchange = ctx.store.insertExchange({ session_id: session.id, method: "GET", url: "http://127.0.0.1/p", response_status: 500 })
    __setDeciderClientForTest({
      argue: async () => ({
        conclusions: { 'refuted(hypothesis("h-mx"))': { status: "Accepted" } },
        extensions: [{ accepted: ["a"] }, { accepted: ["b"] }, { accepted: ["c"] }],
      }),
      evaluate: () => unsupported(),
      solve: () => unsupported(),
      constrain: () => unsupported(),
      kbQuery: () => unsupported(),
      kbAdd: () => unsupported(),
      kbRemove: () => unsupported(),
      check: () => unsupported(),
      status: () => unsupported(),
      disposeSession: () => undefined,
      disposeAll: () => undefined,
      dispose: () => undefined,
    })
    const tool = createProbeHypothesisEvidenceTool(ctx)
    const resp = await tool.execute({
      hypothesis_id: "h-mx",
      exchange_ids: [exchange.id],
      verdict: "refutes",
      run_reasoning_core: true,
      aspic_semantics: "preferred",
    }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { evidence_ids: number[]; aspic_extensions_count: number | null }
    expect(parsed.aspic_extensions_count).toBe(3)
    const evidence = ctx.store.listEvidenceForHypothesis("h-mx")
    expect(evidence[0]?.aspic_extensions_count).toBe(3)
    ctx.store.close()
  })
})

describe("probe-lab v0.5 gate#6 — alert context-population", () => {
  test("probe_alerts_evaluate #given audit_log has 3 provider health_fail entries #when evaluated #then provider_down alert fires", async () => {
    const ctx = makeCtx()
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
    ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-down", action: "health_fail" })
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }> }
    const downAlert = parsed.alerts.find((a) => a.rule === "provider_down" && a.entity_id === "p-down")
    expect(downAlert).toBeDefined()
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given canary lock has recent fail result #when evaluated #then canary_failure alert fires", async () => {
    const ctx = makeCtx()
    ctx.store.upsertIdentity({ id: "id-canary", kind: "api_key", config: {}, status: "active", tier: "canary" })
    ctx.store.insertCanaryLock({ identity_id: "id-canary", locked_by: "test", lock_reason: "watch", canary_test_url: "http://probe/canary" })
    ctx.store.recordCanaryResult("id-canary", "fail")
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }> }
    const canaryAlert = parsed.alerts.find((a) => a.rule === "canary_failure" && a.entity_id === "id-canary")
    expect(canaryAlert).toBeDefined()
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given provider with expires_at less than 1h #when evaluated #then credential_expiry alert fires", async () => {
    const ctx = makeCtx()
    const expiresSoon = Math.floor(Date.now() / 1000) + 600
    ctx.store.insertProvider({
      id: "p-exp",
      name: "expires-soon",
      provider_type: "ds2api",
      base_url: "http://localhost:1",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "x", expires_at: String(expiresSoon) },
    })
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }> }
    const expiryAlert = parsed.alerts.find((a) => a.rule === "credential_expiry" && a.entity_id === "p-exp")
    expect(expiryAlert).toBeDefined()
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given audit_log has experiment abort_safety entry #when evaluated #then experiment_safety_breach alert fires", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-sb", text: "claim", falsifiability_criteria: "c" })
    ctx.store.insertExperiment({ id: "e-breach", hypothesis_id: "h-sb", name: "breached", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 60, require_canary: false } })
    ctx.store.insertAuditLog({ entity_type: "experiment", entity_id: "e-breach", action: "abort_safety", reason: "budget exceeded" })
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }> }
    const breachAlert = parsed.alerts.find((a) => a.rule === "experiment_safety_breach" && a.entity_id === "e-breach")
    expect(breachAlert).toBeDefined()
    ctx.store.close()
  })
})

describe("probe-lab v0.5 gate#6 — abort_safety emission", () => {
  test("probe_experiment_run #given require_canary with no canaries #when run #then audit_log records abort_safety", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-safety", text: "claim", falsifiability_criteria: "c" })
    ctx.store.insertExperiment({ id: "e-safety", hypothesis_id: "h-safety", name: "safety test", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 60, require_canary: true } })
    const resp = await createProbeExperimentRunTool(ctx).execute({ experiment_id: "e-safety", dry_run: false, auto_evidence: true }, { sessionID: "t" } as never)
    expect(resp as string).toContain("no active healthy canaries")
    const audit = ctx.store.listAuditLog({ entity_type: "experiment", action: "abort_safety", limit: 10, offset: 0 })
    expect(audit.total).toBe(1)
    expect(audit.entries[0]?.entity_id).toBe("e-safety")
    ctx.store.close()
  })
})
