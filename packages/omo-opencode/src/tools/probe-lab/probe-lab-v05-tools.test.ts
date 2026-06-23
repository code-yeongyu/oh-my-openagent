/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __setSupersedeKbClientForTest } from "./probe-hypothesis-supersede-tool"
import { __setResurrectKbClientForTest } from "./probe-hypothesis-resurrect-tool"
import { createProbeHypothesisResurrectTool } from "./probe-hypothesis-resurrect-tool"
import { createProbeHypothesisSupersedeTool } from "./probe-hypothesis-supersede-tool"
import { createProbeReplayChainTool } from "./probe-replay-chain-tool"
import { createProbeAlertsEvaluateTool } from "./probe-alerts-evaluate-tool"
import { createProbeExperimentRunTool } from "./probe-experiment-run-tool"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"

let tmpDir: string

const stubKb = {
  argue: async () => ({}),
  kbAdd: async (input: { layer: string; content: unknown; tags: ReadonlyArray<string> }) => ({ id: `kb-stub-${Math.random().toString(36).slice(2, 8)}`, layer: input.layer, content: input.content, tags: input.tags }),
  kbQuery: async () => [],
  kbRemove: async () => ({ removed: 0 }),
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-v05-"))
  __setSupersedeKbClientForTest(stubKb as never)
  __setResurrectKbClientForTest(stubKb as never)
})

afterEach(() => {
  __setSupersedeKbClientForTest(null)
  __setResurrectKbClientForTest(null)
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe-lab v0.5 hypothesis lifecycle", () => {
  test("probe_hypothesis_supersede #given two hypotheses #when supersede is called #then status flips and KB premise is written", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-old", text: "old claim", falsifiability_criteria: "criteria" })
    ctx.store.insertHypothesis({ id: "h-new", text: "new claim", falsifiability_criteria: "criteria" })
    const tool = createProbeHypothesisSupersedeTool(ctx)
    const resp = await tool.execute({ hypothesis_id: "h-old", superseded_by: "h-new", reason: "v2 evidence" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { status: string; kb_entry_id: string | null }
    expect(parsed.status).toBe("superseded")
    expect(parsed.kb_entry_id).toMatch(/^kb-stub-/)
    expect(ctx.store.getHypothesis("h-old")?.superseded_by).toBe("h-new")
    ctx.store.close()
  })

  test("probe_hypothesis_resurrect #given a refuted hypothesis #when resurrect is called #then status becomes resurrected", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-dead", text: "claim", falsifiability_criteria: "criteria" })
    ctx.store.updateHypothesisStatus("h-dead", "refuted", 0)
    const tool = createProbeHypothesisResurrectTool(ctx)
    const resp = await tool.execute({ hypothesis_id: "h-dead", reason: "fresh evidence" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { status: string; previous_status: string }
    expect(parsed.status).toBe("resurrected")
    expect(parsed.previous_status).toBe("refuted")
    expect(ctx.store.getHypothesis("h-dead")?.status).toBe("resurrected")
    ctx.store.close()
  })

  test("probe_hypothesis_resurrect #given an active hypothesis #when resurrect is attempted #then it is rejected", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-live", text: "claim", falsifiability_criteria: "criteria" })
    const resp = await createProbeHypothesisResurrectTool(ctx).execute({ hypothesis_id: "h-live", reason: "rejected" }, { sessionID: "t" } as never)
    expect(resp as string).toContain("must be refuted or superseded")
    ctx.store.close()
  })
})

describe("probe-lab v0.5 replay chain", () => {
  test("probe_replay_chain #given two modifications #when chain runs #then it returns one row per modification", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("replayed", { status: 200 }) })
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-chain", hypothesis_id: null, identity_id: null })
    const original = ctx.store.insertExchange({ session_id: "s-chain", method: "POST", url: server.url.toString(), request_body: JSON.stringify({ message: "hi", cif: "x" }), response_status: 200 })
    const tool = createProbeReplayChainTool(ctx)
    const resp = await tool.execute({
      exchange_id: original.id,
      modifications: [
        { label: "no_cif", modify: { body_transform: "strip_cif" } },
        { label: "no_auth", modify: { headers_remove: ["Authorization"] } },
      ],
    }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { results: Array<{ label: string }>; summary: { total: number } }
    expect(parsed.summary.total).toBe(2)
    expect(parsed.results.map((r) => r.label).sort()).toEqual(["no_auth", "no_cif"])
    server.stop(true)
    ctx.store.close()
  })

  test("probe_replay_chain #given global kill switch #when chain runs #then dispatch is rejected", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test stop")
    ctx.store.insertSession({ id: "s-chain-kill", hypothesis_id: null, identity_id: null })
    const original = ctx.store.insertExchange({ session_id: "s-chain-kill", method: "POST", url: "http://localhost:1", response_status: 200 })
    const resp = await createProbeReplayChainTool(ctx).execute({
      exchange_id: original.id,
      modifications: [{ label: "x", modify: {} }],
    }, { sessionID: "t" } as never)
    expect(resp as string).toContain("global_kill_switch")
    ctx.store.close()
  })
})

describe("probe-lab v0.5 alerts", () => {
  test("probe_alerts_evaluate #given pool with no identities #when evaluated #then no triggered alerts", async () => {
    const ctx = makeCtx()
    const tool = createProbeAlertsEvaluateTool(ctx)
    const resp = await tool.execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string }> }
    expect(Array.isArray(parsed.alerts)).toBe(true)
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given kill switch active #when evaluated #then kill_switch_active alert is emitted", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test")
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; severity: string }> }
    const killAlert = parsed.alerts.find((a) => a.rule === "kill_switch_active")
    expect(killAlert?.severity).toBe("INFO")
    ctx.store.close()
  })

  test("probe_alerts_evaluate #given pool below critical ratio #when evaluated #then pool_critical alert is emitted", async () => {
    const ctx = makeCtx()
    ctx.store.upsertIdentity({ id: "i-1", kind: "api_key", config: {}, status: "quarantined", provider_id: "prov-x" })
    ctx.store.upsertIdentity({ id: "i-2", kind: "api_key", config: {}, status: "quarantined", provider_id: "prov-x" })
    ctx.store.upsertIdentity({ id: "i-3", kind: "api_key", config: {}, status: "active", provider_id: "prov-x" })
    const resp = await createProbeAlertsEvaluateTool(ctx).execute({ format: "json" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { alerts: Array<{ rule: string; entity_id: string | null }> }
    const critical = parsed.alerts.find((a) => a.rule === "pool_critical" && a.entity_id === "prov-x")
    expect(critical).toBeDefined()
    ctx.store.close()
  })
})

describe("probe-lab v0.5 experiment run kill switch", () => {
  test("probe_experiment_run #given kill switch active #when experiment is run #then it is rejected before any status mutation", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-k", text: "claim", falsifiability_criteria: "c" })
    ctx.store.insertExperiment({ id: "e-k", hypothesis_id: "h-k", name: "kill test", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 60, require_canary: false } })
    ctx.store.setProbeLabConfig("global_kill_switch", "1", "test")
    const resp = await createProbeExperimentRunTool(ctx).execute({ experiment_id: "e-k", dry_run: false, auto_evidence: true }, { sessionID: "t" } as never)
    expect(resp as string).toContain("global_kill_switch")
    expect(ctx.store.getExperiment("e-k")?.status).toBe("draft")
    ctx.store.close()
  })
})

