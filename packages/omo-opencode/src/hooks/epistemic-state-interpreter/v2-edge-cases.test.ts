import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { getAnnotations, _resetForTesting as resetAnnotationStore } from "./annotation-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import { clearHistory, getHistory, hydrate, isHydrated, snapshot, updateHistory, _resetForTesting as resetHistoryStore } from "./history-store"
import * as persistenceModule from "./persistence"
import { loadPersistedState } from "./persistence"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"
import type { EpistemicState } from "./types"
import type { HistoryEntry } from "./transition-types"
import type { PersistedSessionState } from "./persistence-types"

const CONFIG = { epistemic_state_interpreter_enabled: true }
const ROOT = ".tmp-v2-edge-cases"

type Spec = {
  conclusion: string
  status: "Accepted" | "Undecided" | "Rejected"
  proofChainKind: "strict" | "defeasible"
  extensionsIn: number
  extensionsTotal: number
  residual?: boolean
}

const input = (sessionID: string, callID: string) => ({ tool: "bash", sessionID, callID })
const output = () => ({ args: {} })
const entry = (classification: EpistemicState, callID: string): HistoryEntry => ({ classification, timestamp: 0, callID })
const history = (state: EpistemicState, callID: string): { currentState: EpistemicState; entries: HistoryEntry[]; consecutiveCount: number; lastClassification: EpistemicState; lastSeenInvocation: number; exclusionTheoryHash: string | undefined } => ({
  currentState: state,
  entries: [entry(state, callID)],
  consecutiveCount: 1,
  lastClassification: state,
  lastSeenInvocation: 0,
  exclusionTheoryHash: undefined,
})

function buildArtifact(specs: Spec[]) {
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

  return { theory: {}, result: { semantics: "preferred", extensions, conclusions } }
}

async function invoke(sessionID: string, callID: string, specs: Spec[]) {
  storeVerdict(`${sessionID}:${callID}`, { allow: true, proofArtifact: buildArtifact(specs) })
  await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(sessionID, callID), output())
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

describe("epistemic-state-interpreter v2 edge cases", () => {
  it("E1 first invocation returns rawClassification", async () => {
    await invoke("s1", "c1", [{ conclusion: "claim(x)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }])
    const annotation = getAnnotations("s1")[0]
    expect(annotation?.state).toBe("open")
    expect(annotation?.rawClassification).toBe("open")
  })

  it("E2 oscillation never accumulates a streak", async () => {
    hydrate("s2", { "claim(x)": history("open", "seed") })
    const specs = [
      { conclusion: "claim(x)", status: "Accepted" as const, proofChainKind: "strict" as const, extensionsIn: 4, extensionsTotal: 5 },
      { conclusion: "claim(x)", status: "Undecided" as const, proofChainKind: "defeasible" as const, extensionsIn: 0, extensionsTotal: 1 },
      { conclusion: "claim(x)", status: "Accepted" as const, proofChainKind: "strict" as const, extensionsIn: 4, extensionsTotal: 5 },
      { conclusion: "claim(x)", status: "Undecided" as const, proofChainKind: "defeasible" as const, extensionsIn: 0, extensionsTotal: 1 },
    ]

    for (const [index, spec] of specs.entries()) {
      await invoke("s2", `c${index + 1}`, [spec])
      expect(getAnnotations("s2").at(-1)?.state).toBe("open")
    }
  })

  it("E3 100 unique conclusions do not crash", async () => {
    await invoke(
      "s3",
      "c1",
      Array.from({ length: 100 }, (_, index) => ({ conclusion: `c${index}(x)`, status: "Accepted" as const, proofChainKind: "strict" as const, extensionsIn: 1, extensionsTotal: 1 })),
    )
    expect(getAnnotations("s3")).toHaveLength(100)
  })

  it("E4 disk write failure leaves in-memory annotations intact", async () => {
    const spy = spyOn(persistenceModule, "persistState").mockImplementation(() => {
      throw new Error("disk")
    })

    await expect(
      invoke("s4", "c1", [{ conclusion: "claim(x)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }]),
    ).resolves.toBeUndefined()

    expect(getAnnotations("s4")).toHaveLength(1)
    spy.mockRestore()
  })

  it("E5 corrupt JSON on disk is treated as no data", async () => {
    mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
    writeFileSync(join(".sisyphus", "epistemic", "s5.json"), "{broken", "utf8")

    await invoke("s5", "c1", [{ conclusion: "claim(x)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }])
    expect(getAnnotations("s5")).toHaveLength(1)
  })

  it("E6 conclusions evolve independently", async () => {
    hydrate("s6", { a: history("accepted", "seed-a"), b: history("plausible", "seed-b") as unknown as ReturnType<typeof history>, c: history("open", "seed-c") })

    const specs = [{ conclusion: "a", status: "Undecided" as const, proofChainKind: "defeasible" as const, extensionsIn: 0, extensionsTotal: 1 }, { conclusion: "b", status: "Undecided" as const, proofChainKind: "defeasible" as const, extensionsIn: 0, extensionsTotal: 1 }, { conclusion: "c", status: "Undecided" as const, proofChainKind: "defeasible" as const, extensionsIn: 0, extensionsTotal: 1 }]
    await invoke("s6", "c1", specs)
    await invoke("s6", "c2", specs)
    await invoke("s6", "c3", specs)

    expect(getAnnotations("s6").filter((annotation) => annotation.conclusion === "a").at(-1)?.state).toBe("accepted")
    expect(getAnnotations("s6").filter((annotation) => annotation.conclusion === "b").at(-1)?.state).toBe("open")
    expect(getAnnotations("s6").filter((annotation) => annotation.conclusion === "c").at(-1)?.state).toBe("open")
  })

  it("E7 special characters round-trip exactly", async () => {
    await invoke("s7", "c1", [{ conclusion: "-promote(marco)", status: "Undecided", proofChainKind: "defeasible", extensionsIn: 0, extensionsTotal: 1 }])
    expect(getAnnotations("s7")[0]?.conclusion).toBe("-promote(marco)")
  })

  it("E8 hydration survives compaction-like activity", () => {
    hydrate("s8", { x: history("open", "seed") })
    updateHistory("s8", "x", entry("open", "c1"), "open")
    expect(isHydrated("s8")).toBe(true)
    expect(snapshot("s8")).toHaveProperty("x")
  })

  it("E9 excluded stays excluded even if later accepted", async () => {
    hydrate("s9", { "some_conclusion(x)": history("excluded", "setup") })
    await invoke("s9", "c1", [{ conclusion: "some_conclusion(x)", status: "Accepted", proofChainKind: "strict", extensionsIn: 1, extensionsTotal: 1 }])
    expect(getAnnotations("s9").at(-1)?.state).toBe("excluded")
  })

  it("E10 rehydration prefers disk after clearHistory", () => {
    const sessionID = "s10"
    const diskState: PersistedSessionState = {
      sessionID,
      updatedAt: 1,
      conclusions: { x: { currentState: "open", entries: [entry("open", "disk")], consecutiveCount: 1, lastSeenInvocation: 0, exclusionTheoryHash: undefined } },
    }

    mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
    writeFileSync(join(".sisyphus", "epistemic", `${sessionID}.json`), JSON.stringify(diskState), "utf8")
    hydrate(sessionID, { x: { currentState: "accepted", entries: [entry("accepted", "memory")], consecutiveCount: 1, lastClassification: "accepted", lastSeenInvocation: 0, exclusionTheoryHash: undefined } })
    clearHistory(sessionID)

    const loaded = loadPersistedState(sessionID)
    expect(loaded?.conclusions.x.currentState).toBe("open")
    hydrate(
      sessionID,
      loaded
        ? {
            x: {
              ...loaded.conclusions.x,
              lastClassification: loaded.conclusions.x.entries.at(-1)?.classification ?? loaded.conclusions.x.currentState,
              exclusionTheoryHash: loaded.conclusions.x.exclusionTheoryHash ?? undefined,
            },
          }
        : {},
    )
    expect(getHistory(sessionID, "x")?.currentState).toBe("open")
  })

  it("E11 trailing whitespace means a different conclusion", () => {
    updateHistory("s11", "a_pred(x)", entry("open", "c1"), "open")
    updateHistory("s11", "a_pred(x) ", entry("open", "c2"), "open")
    expect(getHistory("s11", "a_pred(x)")).toBeDefined()
    expect(getHistory("s11", "a_pred(x) ")).toBeDefined()
    expect(Object.keys(snapshot("s11"))).toHaveLength(2)
  })

  it("E12 no reasoning-core calls produce no annotations", async () => {
    await invoke("s12", "c1", [])
    expect(getAnnotations("s12")).toEqual([])
  })
})
