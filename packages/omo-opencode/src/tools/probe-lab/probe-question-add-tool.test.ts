/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeQuestionAddTool } from "./probe-question-add-tool"
import { createProbeQuestionStatusTool } from "./probe-question-status-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-question-"))
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

describe("probe_question_add and probe_question_status", () => {
  test("add+status #given a question is added #when status is fetched #then returns question fields with empty hypothesis tree", async () => {
    const ctx = makeCtx()
    const addTool = createProbeQuestionAddTool(ctx)
    const statusTool = createProbeQuestionStatusTool(ctx)
    const addResp = await addTool.execute(
      { text: "Why empty SSE?", domain: "llm_reverse", priority: 2 },
      { sessionID: "test" } as never,
    )
    const added = JSON.parse(addResp as string) as { question_id: string; status: string; domain: string; priority: number }
    expect(added.status).toBe("open")
    expect(added.domain).toBe("llm_reverse")
    expect(added.priority).toBe(2)
    const statusResp = await statusTool.execute(
      { question_id: added.question_id, include_hypotheses: true, include_evidence_summary: false },
      { sessionID: "test" } as never,
    )
    const status = JSON.parse(statusResp as string) as { question: { id: string; text: string }; hypotheses: unknown[]; total_hypotheses: number }
    expect(status.question.id).toBe(added.question_id)
    expect(status.question.text).toBe("Why empty SSE?")
    expect(status.hypotheses.length).toBe(0)
    expect(status.total_hypotheses).toBe(0)
    ctx.store.close()
  })
})
