/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import {
  __setReasoningCoreClientForTest,
  decideHypothesisStatus,
} from "./hypothesis-status-decider"
import { createProbeStore } from "./sqlite-store"

type ArgueImpl = NonNullable<ReasoningCoreClient["argue"]>

function createMockClient(argueImpl: ArgueImpl): ReasoningCoreClient {
  return {
    argue: argueImpl,
    evaluate: () => unsupported("evaluate"),
    solve: () => unsupported("solve"),
    constrain: () => unsupported("constrain"),
    kbQuery: () => unsupported("kbQuery"),
    kbAdd: () => unsupported("kbAdd"),
    kbRemove: () => unsupported("kbRemove"),
    check: () => unsupported("check"),
    status: () => unsupported("status"),
    disposeSession: () => undefined,
    disposeAll: () => undefined,
    dispose: () => undefined,
  }
}

function unsupported(method: string): never {
  throw new Error(`mock client method ${method} should not be called`)
}

const TEMPLATE_INPUT = { premises: [] }

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-decider-aspic-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  __setReasoningCoreClientForTest(null)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("decideHypothesisStatus aspic paths", () => {
  test("two-arg conclusion #given reason_argue accepts refuted(hypothesis(id, text)) #when matcher runs #then decision is aspic-conclusive refuted", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({
      id: "h-2arg",
      text: 'two-arg "shaped" claim',
      falsifiability_criteria: "any failing exchange",
      aspic_theory_template: TEMPLATE_INPUT,
    })
    const session = store.insertSession({ id: "s-2arg", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({
      session_id: session.id,
      method: "POST",
      url: "http://127.0.0.1/probe",
      response_status: 500,
    })
    const evidence = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: ex.id,
      verdict: "refutes",
    })
    __setReasoningCoreClientForTest(
      createMockClient(async () => ({
        conclusions: {
          [`refuted(hypothesis("h-2arg", "two-arg \\"shaped\\" claim"))`]: { status: "Accepted" },
        },
      })),
    )
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: evidence.id,
      runReasoningCore: true,
    })
    expect(decision.status).toBe("refuted")
    expect(decision.confidence).toBe(0)
    expect(decision.source).toBe("aspic-conclusive")
    store.close()
  })

  test("inconclusive #given reason_argue accepts an unrelated formula #when no status conclusion matches #then baseline status is preserved as aspic-inconclusive", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({
      id: "h-incon",
      text: "no conclusion",
      falsifiability_criteria: "n/a",
      aspic_theory_template: TEMPLATE_INPUT,
    })
    const session = store.insertSession({ id: "s-incon", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({
      session_id: session.id,
      method: "GET",
      url: "http://127.0.0.1/probe",
      response_status: 200,
    })
    const evidence = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: ex.id,
      verdict: "supports",
    })
    __setReasoningCoreClientForTest(
      createMockClient(async () => ({
        conclusions: {
          "other(predicate)": { status: "Accepted" },
        },
      })),
    )
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "supports",
      latestEvidenceId: evidence.id,
      runReasoningCore: true,
    })
    expect(decision.status).toBe("active")
    expect(decision.source).toBe("aspic-inconclusive")
    expect(decision.confidence).toBe(hypothesis.confidence)
    store.close()
  })

  test("aspic error #given reason_argue throws #when refute is dominant in history #then fallback-error reports refuted", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({
      id: "h-err",
      text: "errors fall back",
      falsifiability_criteria: "n/a",
      aspic_theory_template: TEMPLATE_INPUT,
    })
    const session = store.insertSession({ id: "s-err", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({
      session_id: session.id,
      method: "GET",
      url: "http://127.0.0.1/probe",
      response_status: 500,
    })
    const evidence = store.insertEvidence({
      hypothesis_id: hypothesis.id,
      session_id: session.id,
      exchange_id: ex.id,
      verdict: "refutes",
    })
    __setReasoningCoreClientForTest(
      createMockClient(async () => {
        throw new Error("network down")
      }),
    )
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: evidence.id,
      runReasoningCore: true,
    })
    expect(decision.status).toBe("refuted")
    expect(decision.source).toBe("fallback-error")
    store.close()
  })
})
