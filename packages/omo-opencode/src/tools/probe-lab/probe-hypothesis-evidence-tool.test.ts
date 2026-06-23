/// <reference types="bun-types" />

import type { ToolContext } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __setReasoningCoreClientForTest } from "../../features/probe-lab/falsification-writer"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeStore, type ProbeStore } from "../../features/probe-lab/sqlite-store"
import type { ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import { createProbeHypothesisEvidenceTool } from "./probe-hypothesis-evidence-tool"

type CountingClient = ReasoningCoreClient & { calls: () => number }

function createCountingClient(): CountingClient {
  let count = 0
  return {
    argue: () => unsupported("argue"),
    evaluate: () => unsupported("evaluate"),
    solve: () => unsupported("solve"),
    constrain: () => unsupported("constrain"),
    kbQuery: () => unsupported("kbQuery"),
    kbAdd: async () => {
      count += 1
      return { id: `kb-${count}` }
    },
    kbRemove: () => unsupported("kbRemove"),
    check: () => unsupported("check"),
    status: () => unsupported("status"),
    disposeSession: () => undefined,
    disposeAll: () => undefined,
    dispose: () => undefined,
    calls: () => count,
  }
}

function unsupported(method: string): never {
  throw new Error(`mock client method ${method} should not be called`)
}

const TEST_CONTEXT: ToolContext = {
  sessionID: "probe-evidence-test",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => undefined,
  ask: () => Effect.void,
}

let tmpDir: string
let dbPath: string
let store: ProbeStore
let client: CountingClient
let hypothesisId: string
let exchangeIds: number[]

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-evidence-"))
  dbPath = join(tmpDir, "lab.db")
  store = createProbeStore(dbPath)
  client = createCountingClient()
  __setReasoningCoreClientForTest(client)
  const hypothesis = store.insertHypothesis({
    id: "h-evidence",
    text: "evidence flow",
    falsifiability_criteria: "any failing exchange",
  })
  hypothesisId = hypothesis.id
  const session = store.insertSession({ id: "s-ev", hypothesis_id: hypothesis.id, identity_id: null })
  const ex1 = store.insertExchange({
    session_id: session.id,
    method: "POST",
    url: "http://127.0.0.1/probe",
    response_status: 500,
  })
  const ex2 = store.insertExchange({
    session_id: session.id,
    method: "POST",
    url: "http://127.0.0.1/probe",
    response_status: 500,
  })
  exchangeIds = [ex1.id, ex2.id]
})

afterEach(() => {
  __setReasoningCoreClientForTest(null)
  store.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

type EvidenceArgs = {
  hypothesis_id: string
  exchange_ids: number[]
  verdict: "supports" | "refutes" | "inconclusive"
  reasoning?: string
  run_reasoning_core: boolean
}

type EvidenceResponse = {
  hypothesis_status: string
  kb_entries_added: string[]
}

async function runEvidence(args: EvidenceArgs): Promise<EvidenceResponse> {
  const tool = createProbeHypothesisEvidenceTool({
    store,
    pool: createIdentityPool({ store }),
    providerRegistry: createProviderRegistry({ store }),
  })
  const raw = await tool.execute(args, TEST_CONTEXT)
  if (typeof raw !== "string" || raw.startsWith("[ERROR]")) {
    throw new Error(`unexpected tool response: ${String(raw)}`)
  }
  return JSON.parse(raw) as EvidenceResponse
}

describe("probe_hypothesis_evidence KB dedupe", () => {
  test("repeated refutes #given hypothesis was already refuted #when refute is recorded again #then no second KB write fires", async () => {
    const first = await runEvidence({
      hypothesis_id: hypothesisId,
      exchange_ids: [exchangeIds[0]!],
      verdict: "refutes",
      run_reasoning_core: false,
    })
    expect(first.hypothesis_status).toBe("refuted")
    expect(first.kb_entries_added).toEqual(["kb-1"])
    expect(client.calls()).toBe(1)
    const second = await runEvidence({
      hypothesis_id: hypothesisId,
      exchange_ids: [exchangeIds[1]!],
      verdict: "refutes",
      run_reasoning_core: false,
    })
    expect(second.hypothesis_status).toBe("refuted")
    expect(second.kb_entries_added).toEqual([])
    expect(client.calls()).toBe(1)
  })
})
