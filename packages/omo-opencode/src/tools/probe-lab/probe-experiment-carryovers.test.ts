/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProbeCaptureDiffTool } from "./probe-capture-diff-tool"
import { createProbeExperimentAbortTool } from "./probe-experiment-abort-tool"
import { createProbeExperimentRunTool } from "./probe-experiment-run-tool"
import { createProbeExperimentStatusTool } from "./probe-experiment-status-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-experiment-"))
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

describe("experiment carryover tools", () => {
  test("probe_experiment_run #given require_canary without canaries #when run #then returns explicit error", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-exp", text: "claim", falsifiability_criteria: "criteria" })
    ctx.store.insertExperiment({ id: "exp-1", hypothesis_id: "h-exp", name: "exp", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 300, require_canary: true } })
    const resp = await createProbeExperimentRunTool(ctx).execute({ experiment_id: "exp-1", dry_run: true, auto_evidence: true }, { sessionID: "test" } as never)
    expect(resp).toBe("[ERROR] no active healthy canaries available; cannot run experiment with require_canary=true (have 0 canary-tier but none active+closed-circuit)")
    ctx.store.close()
  })

  test("probe_experiment_run #given all canaries have open circuits #when canary is required #then run is rejected", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-exp-open", text: "claim", falsifiability_criteria: "criteria" })
    ctx.store.insertExperiment({ id: "exp-open", hypothesis_id: "h-exp-open", name: "exp", protocol: [], safety_budget: { max_identities_burned: 3, max_time_s: 300, require_canary: true } })
    for (const id of ["id-a", "id-b", "id-c"]) {
      ctx.store.upsertIdentity({ id, kind: "api_key", config: {}, status: "active", tier: "canary" })
      ctx.store.setIdentityCircuitState({ id, state: "open", consecutiveFailures: 3, lastFailureAt: 1, quarantinedUntil: null })
    }
    const resp = await createProbeExperimentRunTool(ctx).execute({ experiment_id: "exp-open", dry_run: true, auto_evidence: true }, { sessionID: "test" } as never)
    expect(resp).toBe("[ERROR] no active healthy canaries available; cannot run experiment with require_canary=true (have 3 canary-tier but none active+closed-circuit)")
    ctx.store.close()
  })

  test("status and abort #given experiment with session #when queried and aborted #then status changes", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-exp", text: "claim", falsifiability_criteria: "criteria" })
    ctx.store.insertExperiment({ id: "exp-2", hypothesis_id: "h-exp", name: "exp", protocol: [] })
    ctx.store.insertSession({ id: "s-exp", hypothesis_id: "h-exp", identity_id: null, experiment_id: "exp-2" })
    const status = await createProbeExperimentStatusTool(ctx).execute({ experiment_id: "exp-2", include_sessions: true }, { sessionID: "test" } as never)
    expect(JSON.parse(status as string).sessions).toHaveLength(1)
    const aborted = await createProbeExperimentAbortTool(ctx).execute({ experiment_id: "exp-2", reason: "stop" }, { sessionID: "test" } as never)
    expect(JSON.parse(aborted as string).status).toBe("aborted")
    expect(ctx.store.getExperiment("exp-2")?.status).toBe("aborted")
    ctx.store.close()
  })

  test("probe_capture_diff #given two JSON responses #when diffed #then structural changes are returned", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-diff", hypothesis_id: null, identity_id: null })
    const a = ctx.store.insertExchange({ session_id: "s-diff", method: "GET", url: "https://example.test", response_status: 200, response_body: '{"ok":true,"n":1}' })
    const b = ctx.store.insertExchange({ session_id: "s-diff", method: "GET", url: "https://example.test", response_status: 403, response_body: '{"ok":false,"n":1,"blocked":true}' })
    const resp = await createProbeCaptureDiffTool(ctx).execute({ exchange_id_a: a.id, exchange_id_b: b.id, structural_diff: true }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { changed_fields: string[]; identical_fields: string[] }
    expect(parsed.changed_fields).toContain("response_status")
    expect(parsed.changed_fields).toContain("ok")
    expect(parsed.identical_fields).toContain("n")
    ctx.store.close()
  })
})
