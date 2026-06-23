import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { getAnnotations, _resetForTesting as resetAnnotationStore } from "./annotation-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import { getHistory, hydrate, _resetForTesting as resetHistoryStore } from "./history-store"
import * as persistenceModule from "./persistence"
import { computeTheoryHash } from "./theory-hasher"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"
import type { EpistemicState } from "./types"
import type { HistoryEntry, ConclusionHistory } from "./transition-types"

type Spec = {
  conclusion: string
  status: "Accepted" | "Undecided" | "Rejected"
  proofChainKind: "strict" | "defeasible"
  extensionsIn: number
  extensionsTotal: number
  residual?: boolean
}

const ENABLED_CONFIG = { epistemic_state_interpreter_enabled: true }
const ROOT = ".tmp-v3-integration"
const input = (sessionID: string, callID: string) => ({ tool: "bash", sessionID, callID })
const output = () => ({ args: {} })
const entry = (classification: EpistemicState, callID: string): HistoryEntry => ({ classification, timestamp: 0, callID })

function history(state: EpistemicState, callID: string, overrides: Partial<ConclusionHistory> = {}): ConclusionHistory {
  return {
    currentState: state,
    entries: [entry(state, callID)],
    consecutiveCount: 1,
    lastClassification: state,
    lastSeenInvocation: 0,
    exclusionTheoryHash: undefined,
    ...overrides,
  }
}

function buildArtifact(specs: Spec[], theory: Record<string, unknown> = {}) {
  const total = Math.max(...specs.map((spec) => spec.extensionsTotal), 0)
  const extensions = Array.from({ length: total }, (_, index) => ({ index, accepted_conclusions: [] as string[] }))
  const conclusions: Record<string, { status: Spec["status"]; proof_chain: Array<{ conclusion: string; from: string[]; rule_id: string | null; rule_kind: "ordinary" | "strict" | "defeasible" }> }> = {}

  for (const spec of specs) {
    conclusions[spec.conclusion] = {
      status: spec.status,
      proof_chain: [
        ...(spec.status === "Rejected" && spec.residual ? [{ conclusion: spec.conclusion, from: [], rule_id: "d0", rule_kind: "defeasible" as const }] : []),
        { conclusion: spec.conclusion, from: [], rule_id: spec.proofChainKind === "strict" ? "s1" : "d1", rule_kind: spec.proofChainKind },
      ],
    }

    for (let index = 0; index < spec.extensionsIn; index += 1) {
      extensions[index]?.accepted_conclusions.push(spec.conclusion)
    }
  }

  return { theory, result: { semantics: "preferred", extensions, conclusions } }
}

async function invoke(
  sessionID: string,
  callID: string,
  specs: Spec[],
  config: typeof ENABLED_CONFIG = ENABLED_CONFIG,
  theory: Record<string, unknown> = {},
) {
  storeVerdict(`${sessionID}:${callID}`, { allow: true, proofArtifact: buildArtifact(specs, theory) })
  await createEpistemicStateInterpreterHook(config)["tool.execute.before"](input(sessionID, callID), output())
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(ROOT, { recursive: true })
  process.chdir(ROOT)
})

afterEach(() => {
  resetVerdictStore()
  resetAnnotationStore()
  resetHistoryStore()
  process.chdir("..")
  rmSync(ROOT, { recursive: true, force: true })
})

describe("epistemic-state-interpreter v3 integration", () => {
  it("uses config-driven thresholds for T1", async () => {
    const sessionID = "v3-config-thresholds"
    const config = {
      epistemic_state_interpreter_enabled: true,
      epistemic_thresholds: { n: 2, m: 4, k: 8, t: 25 },
    }

    await invoke(sessionID, "c1", [{ conclusion: "claim(x)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }], config)
    await invoke(sessionID, "c2", [{ conclusion: "claim(x)", status: "Accepted", proofChainKind: "defeasible", extensionsIn: 1, extensionsTotal: 1 }], config)
    await invoke(sessionID, "c3", [{ conclusion: "claim(x)", status: "Accepted", proofChainKind: "defeasible", extensionsIn: 1, extensionsTotal: 1 }], config)

    const states = getAnnotations(sessionID).map((annotation) => annotation.state)
    expect(states).toEqual(["open", "open", "plausible"])
  })

  it("decays stale conclusions after T absent invocations", async () => {
    const sessionID = "v3-decay"
    const config = {
      epistemic_state_interpreter_enabled: true,
      epistemic_thresholds: { n: 3, m: 5, k: 10, t: 50 },
    }

    hydrate(sessionID, {
      stale: history("accepted", "seed", { lastSeenInvocation: 0 }),
    })

    await invoke(sessionID, "c1", [{ conclusion: "fresh", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }], config)
    for (let index = 2; index <= 50; index += 1) {
      await invoke(sessionID, `c${index}`, [{ conclusion: `fresh-${index}`, status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }], config)
    }

    expect(getHistory(sessionID, "stale")?.currentState).toBe("plausible")
  })

  it("resurrects excluded conclusions when theory hash changes", async () => {
    const sessionID = "v3-resurrection"
    const previousTheory = { rules: ["old"] }
    hydrate(sessionID, {
      claim: history("excluded", "seed", { exclusionTheoryHash: computeTheoryHash(previousTheory) }),
    })

    await invoke(
      sessionID,
      "c1",
      [{ conclusion: "claim", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }],
      ENABLED_CONFIG,
      { rules: ["changed"] },
    )

    const latest = getAnnotations(sessionID).at(-1)
    expect(latest?.state).toBe("open")
    expect(getHistory(sessionID, "claim")?.currentState).toBe("open")
  })

  it("uses default thresholds in degraded mode when config is omitted", async () => {
    const sessionID = "v3-default-thresholds"

    await invoke(sessionID, "c1", [{ conclusion: "claim(x)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }])
    await invoke(sessionID, "c2", [{ conclusion: "claim(x)", status: "Accepted", proofChainKind: "defeasible", extensionsIn: 1, extensionsTotal: 1 }])
    await invoke(sessionID, "c3", [{ conclusion: "claim(x)", status: "Accepted", proofChainKind: "defeasible", extensionsIn: 1, extensionsTotal: 1 }])
    await invoke(sessionID, "c4", [{ conclusion: "claim(x)", status: "Accepted", proofChainKind: "defeasible", extensionsIn: 1, extensionsTotal: 1 }])

    const states = getAnnotations(sessionID).map((annotation) => annotation.state)
    expect(states).toEqual(["open", "open", "open", "plausible"])
  })

  it("processes 100 present conclusions and 50 stale ones under 50ms", async () => {
    const sessionID = "v3-performance"
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})

    hydrate(
      sessionID,
      Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [
          `stale-${index}`,
          history("accepted", `seed-${index}`, { lastSeenInvocation: 0 }),
        ]),
      ),
    )

    for (let index = 1; index < 50; index += 1) {
      await invoke(
        sessionID,
        `warm-${index}`,
        [{ conclusion: `warm-${index}`, status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }],
      )
    }

    const specs = Array.from({ length: 100 }, (_, index) => ({
      conclusion: `present-${index}`,
      status: "Accepted" as const,
      proofChainKind: "strict" as const,
      extensionsIn: 1,
      extensionsTotal: 1,
    }))

    const startedAt = performance.now()
    await invoke(sessionID, "c50", specs)
    const elapsed = performance.now() - startedAt

    expect(elapsed).toBeLessThan(50)
    expect(getAnnotations(sessionID).slice(-100)).toHaveLength(100)
    expect(getHistory(sessionID, "stale-0")?.currentState).toBe("plausible")
    persistSpy.mockRestore()
  })
})
