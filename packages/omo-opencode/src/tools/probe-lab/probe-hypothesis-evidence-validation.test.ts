/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeHypothesisEvidenceTool } from "./probe-hypothesis-evidence-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-evidence-tx-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function seed() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  store.insertHypothesis({ id: "h-1", text: "claim", falsifiability_criteria: "c" })
  const session = store.insertSession({ id: "s-1", hypothesis_id: "h-1", identity_id: null })
  const validExchange = store.insertExchange({
    session_id: session.id,
    method: "POST",
    url: "https://x.test/a",
    response_status: 200,
    response_body: "ok",
  })
  return { store, pool, providerRegistry, validExchangeId: validExchange.id }
}

describe("probe_hypothesis_evidence transactional validation", () => {
  test("partial-write rollback #given exchange_ids contains a missing id after a valid one #when called #then returns ERROR and zero evidence rows persist", async () => {
    const ctx = seed()
    const tool = createProbeHypothesisEvidenceTool(ctx)
    const beforeCount = ctx.store.listEvidenceForHypothesis("h-1").length
    expect(beforeCount).toBe(0)
    const resp = await tool.execute(
      {
        hypothesis_id: "h-1",
        exchange_ids: [ctx.validExchangeId, 99999],
        verdict: "supports",
        run_reasoning_core: false,
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("[ERROR]")
    expect(resp as string).toContain("exchange not found: 99999")
    const afterCount = ctx.store.listEvidenceForHypothesis("h-1").length
    expect(afterCount).toBe(0)
    ctx.store.close()
  })

  test("no rollback on success #given two valid exchange ids #when called #then both evidence rows persist", async () => {
    const ctx = seed()
    const tool = createProbeHypothesisEvidenceTool(ctx)
    const ex2 = ctx.store.insertExchange({
      session_id: "s-1",
      method: "POST",
      url: "https://x.test/b",
      response_status: 200,
      response_body: "ok",
    })
    const resp = await tool.execute(
      {
        hypothesis_id: "h-1",
        exchange_ids: [ctx.validExchangeId, ex2.id],
        verdict: "supports",
        run_reasoning_core: false,
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { evidence_ids: number[]; previous_status: string }
    expect(parsed.evidence_ids.length).toBe(2)
    expect(parsed.previous_status).toBe("active")
    expect(ctx.store.listEvidenceForHypothesis("h-1").length).toBe(2)
    ctx.store.close()
  })
})
