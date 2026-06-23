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
import { derivePianoDPreferences } from "./piano-d-preference-deriver"
import { createProbeStore } from "./sqlite-store"
import type { Evidence } from "./types"

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
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-decider-v05-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  __setReasoningCoreClientForTest(null)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("Falsification 2.0 multi-extension semantics", () => {
  test("preferred semantics #given two extensions both accepting refuted #when decider runs #then status stays active and uncertainty_label is high", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({ id: "h-multi", text: "multi-ext", falsifiability_criteria: "n/a", aspic_theory_template: TEMPLATE_INPUT })
    const session = store.insertSession({ id: "s-multi", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({ session_id: session.id, method: "GET", url: "http://127.0.0.1/x", response_status: 500 })
    const evidence = store.insertEvidence({ hypothesis_id: hypothesis.id, session_id: session.id, exchange_id: ex.id, verdict: "refutes" })
    __setReasoningCoreClientForTest(
      createMockClient(async () => ({
        conclusions: { 'refuted(hypothesis("h-multi"))': { status: "Accepted" } },
        extensions: [{ accepted: ["refuted"] }, { accepted: ["confirmed"] }],
      })),
    )
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: evidence.id,
      runReasoningCore: true,
      aspicSemantics: "preferred",
    })
    expect(decision.source).toBe("aspic-multi-extension")
    expect(decision.status).toBe("active")
    expect(decision.uncertaintyLabel).toBe("high")
    expect(decision.extensionsCount).toBe(2)
    store.close()
  })

  test("grounded semantics #given two extensions reported #when decider runs #then unique extension behavior is preserved (refuted)", async () => {
    const store = createProbeStore(dbPath)
    const hypothesis = store.insertHypothesis({ id: "h-grounded", text: "grounded ext", falsifiability_criteria: "n/a", aspic_theory_template: TEMPLATE_INPUT })
    const session = store.insertSession({ id: "s-grounded", hypothesis_id: hypothesis.id, identity_id: null })
    const ex = store.insertExchange({ session_id: session.id, method: "GET", url: "http://127.0.0.1/x", response_status: 500 })
    const evidence = store.insertEvidence({ hypothesis_id: hypothesis.id, session_id: session.id, exchange_id: ex.id, verdict: "refutes" })
    __setReasoningCoreClientForTest(
      createMockClient(async () => ({
        conclusions: { 'refuted(hypothesis("h-grounded"))': { status: "Accepted" } },
        extensions: [{ accepted: ["a"] }, { accepted: ["b"] }],
      })),
    )
    const decision = await decideHypothesisStatus({
      hypothesis,
      evidenceHistory: store.listEvidenceForHypothesis(hypothesis.id),
      latestVerdict: "refutes",
      latestEvidenceId: evidence.id,
      runReasoningCore: true,
      aspicSemantics: "grounded",
    })
    expect(decision.source).toBe("aspic-conclusive")
    expect(decision.status).toBe("refuted")
    store.close()
  })
})

describe("Piano D preference derivation", () => {
  test("more recent supports #given older refute and newer support #when prefs derived #then support_dominates", () => {
    const history: Evidence[] = [
      makeEvidence({ id: 1, verdict: "refutes", confidence: 0.5, created_at: 100 }),
      makeEvidence({ id: 2, verdict: "supports", confidence: 0.5, created_at: 200 }),
    ]
    const prefs = derivePianoDPreferences(history)
    expect(prefs).toContainEqual({ superior: "support-evidence-2", inferior: "refute-evidence-1" })
  })

  test("higher confidence support #given older support but higher confidence #when prefs derived #then support_dominates", () => {
    const history: Evidence[] = [
      makeEvidence({ id: 5, verdict: "refutes", confidence: 0.4, created_at: 200 }),
      makeEvidence({ id: 6, verdict: "supports", confidence: 0.9, created_at: 100 }),
    ]
    const prefs = derivePianoDPreferences(history)
    expect(prefs).toContainEqual({ superior: "support-evidence-6", inferior: "refute-evidence-5" })
  })

  test("equal evidence #given same time and confidence #when prefs derived #then no preference is emitted", () => {
    const history: Evidence[] = [
      makeEvidence({ id: 7, verdict: "refutes", confidence: 0.5, created_at: 100 }),
      makeEvidence({ id: 8, verdict: "supports", confidence: 0.5, created_at: 100 }),
    ]
    expect(derivePianoDPreferences(history)).toEqual([])
  })
})

function makeEvidence(args: { id: number; verdict: "supports" | "refutes" | "inconclusive"; confidence: number; created_at: number }): Evidence {
  return {
    id: args.id,
    hypothesis_id: "h",
    session_id: "s",
    exchange_id: null,
    verdict: args.verdict,
    confidence: args.confidence,
    reasoning: null,
    aspic_preference_impact: null,
    aspic_extensions_count: null,
    kb_entry_id: null,
    previous_evidence_id: null,
    created_at: args.created_at,
  }
}
