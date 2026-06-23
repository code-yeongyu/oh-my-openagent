/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "./sqlite-store"
import { decideHypothesisStatus } from "./hypothesis-status-decider"

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-decider-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("decideHypothesisStatus", () => {
  test("§9 dogfood #given supports then refutes #when run_reasoning_core is false #then status is refuted (dominant verdict)", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({
      id: "h-cif-001",
      text: "CIF file dereference fails for prompts >= 4000 chars",
      falsifiability_criteria: "Disabling CIF restores token streaming",
    })
    const session = store.insertSession({ id: "s-1", hypothesis_id: hypothesis.id, identity_id: null })
    const exA = store.insertExchange({
      session_id: session.id,
      method: "POST",
      url: "http://127.0.0.1:5001/v1/chat/completions",
      response_status: 200,
      response_body: "194B-error-shape",
    })
    const exB = store.insertExchange({
      session_id: session.id,
      method: "POST",
      url: "http://127.0.0.1:5001/v1/chat/completions",
      response_status: 200,
      response_body: "tokens streaming normally",
    })
    const supportEvidence = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: exA.id,
      verdict: "supports",
    })
    const supportDecision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "supports",
      latestEvidenceId: supportEvidence.id,
      runReasoningCore: false,
    })
    expect(supportDecision.status).toBe("active")
    store.updateHypothesisStatus(hypothesis.id, supportDecision.status, supportDecision.confidence)
    const refuteEvidence = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: exB.id,
      verdict: "refutes",
    })
    const refuteDecision = await decideHypothesisStatus({
      hypothesis: store.getHypothesis(hypothesis.id)!,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: refuteEvidence.id,
      runReasoningCore: false,
    })
    expect(refuteDecision.status).toBe("refuted")
    expect(refuteDecision.source).toBe("fallback-weights")
    store.close()
  })

  test("solitary refute #given no prior supports #when refute arrives #then status is refuted", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({
      id: "h-solo",
      text: "Solo refute claim",
      falsifiability_criteria: "any failing exchange",
    })
    const session = store.insertSession({ id: "s-solo", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({
      session_id: session.id,
      method: "GET",
      url: "http://127.0.0.1/probe",
      response_status: 500,
    })
    const refute = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: ex.id,
      verdict: "refutes",
    })
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: refute.id,
      runReasoningCore: false,
    })
    expect(decision.status).toBe("refuted")
    store.close()
  })
})
