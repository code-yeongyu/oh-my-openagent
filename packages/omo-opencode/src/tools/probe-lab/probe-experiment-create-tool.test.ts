/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeExperimentCreateTool } from "./probe-experiment-create-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-exp-"))
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

describe("probe_experiment_create", () => {
  test("create #given an existing hypothesis #when experiment created with protocol #then returns experiment_id with default safety budget", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-1", text: "claim", falsifiability_criteria: "c" })
    const tool = createProbeExperimentCreateTool(ctx)
    const resp = await tool.execute(
      {
        hypothesis_id: "h-1",
        name: "test exp",
        protocol: [{ step: 1, action: "probe_run", params: { url: "http://x.test" } }],
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as {
      experiment_id: string
      status: string
      safety_budget_remaining: { max_identities_burned: number; require_canary: boolean }
    }
    expect(parsed.status).toBe("draft")
    expect(parsed.safety_budget_remaining.max_identities_burned).toBe(3)
    expect(parsed.safety_budget_remaining.require_canary).toBe(false)
    ctx.store.close()
  })

  test("create #given a missing hypothesis_id #when create called #then returns ERROR", async () => {
    const ctx = makeCtx()
    const tool = createProbeExperimentCreateTool(ctx)
    const resp = await tool.execute(
      {
        hypothesis_id: "nope",
        name: "x",
        protocol: [{ step: 1, action: "probe_run" }],
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("[ERROR]")
    expect(resp as string).toContain("hypothesis not found")
    ctx.store.close()
  })
})
