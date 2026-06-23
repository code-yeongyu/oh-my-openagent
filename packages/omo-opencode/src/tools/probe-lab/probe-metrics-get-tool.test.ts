/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProbeMetricsGetTool } from "./probe-metrics-get-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-metrics-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("probe_metrics_get", () => {
  test("prometheus #given probe data #when fetched #then scrape text contains required metrics", async () => {
    const store = createProbeStore(join(tmpDir, "lab.db"))
    const ctx = { store, pool: createIdentityPool({ store }), providerRegistry: createProviderRegistry({ store }) }
    store.insertHypothesis({ id: "h-m", text: "claim", falsifiability_criteria: "criteria" })
    store.insertProvider({ id: "p-m", name: "metrics-provider", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "none", auth_config: {} })
    store.insertSession({ id: "s-m", hypothesis_id: "h-m", identity_id: null, provider_id: "p-m" })
    store.insertExchange({ session_id: "s-m", method: "GET", url: "https://example.test", response_status: 200, timing_total_ms: 42 })
    const resp = await createProbeMetricsGetTool(ctx).execute({ format: "prometheus" }, { sessionID: "test" } as never)
    expect(resp as string).toContain("probe_exchanges_total")
    expect(resp as string).toContain("probe_exchange_duration_ms")
    expect(resp as string).toContain("probe_hypothesis_count")
    store.close()
  })
})
