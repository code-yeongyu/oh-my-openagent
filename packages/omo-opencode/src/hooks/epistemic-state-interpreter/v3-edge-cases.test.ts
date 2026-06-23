import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import {
  buildTransitionTable,
  checkResurrection,
  computeDecay,
  computeTheoryHash,
  createEpistemicStateInterpreterHook,
  getSessionInvocationCount,
  resolveThresholds,
} from "./index"
import { loadPersistedState } from "./persistence"
import { getHistory, snapshot, _resetForTesting as resetHistoryStore } from "./history-store"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"

const ROOT = ".tmp-v3-edge-cases"
const CONFIG = { epistemic_state_interpreter_enabled: true }
const sleep = () => new Promise((resolve) => setTimeout(resolve, 5))
const input = (sessionID: string, callID: string) => ({ tool: "bash", sessionID, callID })
const output = () => ({ args: {} })
const file = (sessionID: string) => join(".sisyphus", "epistemic", `${sessionID}.json`)
const artifact = (
  theory: unknown = {},
  status = "Rejected",
  inCount = 0,
  total = 1,
  proofChainKind: "strict" | "defeasible" = "strict",
) => ({
  theory,
  result: {
    semantics: "preferred",
    extensions: Array.from({ length: total }, (_, index) => ({ index, accepted_conclusions: index < inCount ? ["claim(x)"] : [] })),
    conclusions: {
      "claim(x)": {
        status,
        proof_chain: [{ conclusion: "claim(x)", from: [], rule_id: proofChainKind === "strict" ? "s1" : "d1", rule_kind: proofChainKind }],
      },
    },
  },
})
const state = (currentState: "accepted" | "plausible" | "open" | "operationally_excluded" | "excluded", callID: string) => ({
  currentState,
  entries: [{ classification: currentState, timestamp: 0, callID }],
  consecutiveCount: 1,
  lastClassification: currentState,
  lastSeenInvocation: 0,
  exclusionTheoryHash: undefined,
})

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(ROOT, { recursive: true })
  process.chdir(ROOT)
})

afterEach(() => {
  resetVerdictStore()
  resetHistoryStore()
  process.chdir("..")
  rmSync(ROOT, { recursive: true, force: true })
})

describe("epistemic-state-interpreter v3 edge cases", () => {
  it("E1 #given V2 file missing lastSeenInvocation #when loaded #then defaults to 0", () => {
    mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
    writeFileSync(file("s1"), JSON.stringify({ sessionID: "s1", updatedAt: 1, conclusions: { c1: { currentState: "accepted", entries: [], consecutiveCount: 1, exclusionTheoryHash: undefined } } }), "utf8")
    expect(loadPersistedState("s1")?.conclusions.c1.lastSeenInvocation).toBe(0)
  })

  it("E2 #given V2 file missing exclusionTheoryHash #when loaded #then defaults to undefined", () => {
    mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
    writeFileSync(file("s2"), JSON.stringify({ sessionID: "s2", updatedAt: 1, conclusions: { c1: { currentState: "accepted", entries: [], consecutiveCount: 1, lastSeenInvocation: 7 } } }), "utf8")
    expect(loadPersistedState("s2")?.conclusions.c1.exclusionTheoryHash).toBeUndefined()
  })

  it("E3 #given absent for T-1 and T #when decayed #then only T decays", () => {
    expect(computeDecay({ currentState: "open", lastSeenInvocation: 950, currentInvocation: 999, decayThreshold: 50 }).decayed).toBe(false)
    expect(computeDecay({ currentState: "open", lastSeenInvocation: 950, currentInvocation: 1000, decayThreshold: 50 }).decayed).toBe(true)
  })

  it("E4 #given 3T absence #when decayed #then drops one level only", () => {
    expect(computeDecay({ currentState: "accepted", lastSeenInvocation: 0, currentInvocation: 150, decayThreshold: 50 }).newState).toBe("plausible")
  })

  it("E5 #given excluded history and new theory #when invoked #then resurrection clears hash", async () => {
    const s = "s5"
    const old = computeTheoryHash({ old: 1 })
    const next = computeTheoryHash({ next: 2 })
    storeVerdict(`${s}:c1`, { allow: true, proofArtifact: artifact({ old: 1 }, "Rejected", 0, 1, "strict") })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c1"), output())
    await sleep()
    expect(getHistory(s, "claim(x)")?.currentState).toBe("excluded")
    expect(getHistory(s, "claim(x)")?.exclusionTheoryHash).toBe(old)
    storeVerdict(`${s}:c2`, { allow: true, proofArtifact: artifact({ next: 2 }, "Rejected", 0, 1, "strict") })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c2"), output())
    await sleep()
    expect(getHistory(s, "claim(x)")?.currentState).toBe("open")
    expect(getHistory(s, "claim(x)")?.exclusionTheoryHash).toBeUndefined()
    expect(next).not.toBe(old)
  })

  it("E6 #given resurrection and same excluded verdict #when invoked again #then state stays open", async () => {
    const s = "s6"
    storeVerdict(`${s}:c1`, { allow: true, proofArtifact: artifact({ a: 1 }, "Rejected", 0, 1, "strict") })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c1"), output())
    storeVerdict(`${s}:c2`, { allow: true, proofArtifact: artifact({ b: 2 }, "Rejected", 0, 1, "strict") })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c2"), output())
    storeVerdict(`${s}:c3`, { allow: true, proofArtifact: artifact({ b: 2 }, "Rejected", 0, 1, "strict") })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c3"), output())
    await sleep()
    expect(getHistory(s, "claim(x)")?.currentState).toBe("open")
  })

  it("E7 #given custom thresholds #when resolved #then overrides defaults", () => {
    const resolved = resolveThresholds({ epistemic_thresholds: { n: 2, m: 4, k: 8, t: 25 } })
    expect(resolved).toEqual({ N: 2, M: 4, K: 8, T: 25 })
    expect(buildTransitionTable(resolved)[0]?.thresholdValue).toBe(2)
  })

  it("E8 #given invalid threshold config #when resolved #then returns defaults", () => {
    expect(resolveThresholds({ epistemic_thresholds: { n: 10, m: 5, k: 10, t: 50 } }).N).toBe(3)
  })

  it("E9 #given current invocation #when invoked #then lastSeenInvocation blocks same-cycle decay", async () => {
    const s = "s9"
    storeVerdict(`${s}:c1`, { allow: true, proofArtifact: artifact({ a: 1 }, "Accepted", 1, 1) })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c1"), output())
    await sleep()
    expect(getSessionInvocationCount(s)).toBe(1)
    expect(getHistory(s, "claim(x)")?.lastSeenInvocation).toBe(1)
  })

  it("E10 #given multiple conclusions #when decayed #then each steps independently", () => {
    expect(computeDecay({ currentState: "accepted", lastSeenInvocation: 0, currentInvocation: 100, decayThreshold: 50 }).newState).toBe("plausible")
    expect(computeDecay({ currentState: "plausible", lastSeenInvocation: 0, currentInvocation: 100, decayThreshold: 50 }).newState).toBe("open")
    expect(computeDecay({ currentState: "open", lastSeenInvocation: 0, currentInvocation: 100, decayThreshold: 50 }).newState).toBe("operationally_excluded")
  })

  it("E11 #given null theory hash #when checked #then resurrection is impossible", () => {
    expect(checkResurrection({ currentState: "excluded", exclusionTheoryHash: "abc123", currentTheoryHash: "" }).shouldResurrect).toBe(false)
  })

  it("E12 #given empty theory #when hashed #then same hash blocks resurrection and different hash allows it", () => {
    const hash = computeTheoryHash({})
    expect(hash).not.toBe("")
    expect(checkResurrection({ currentState: "excluded", exclusionTheoryHash: hash, currentTheoryHash: hash }).shouldResurrect).toBe(false)
    expect(checkResurrection({ currentState: "excluded", exclusionTheoryHash: hash, currentTheoryHash: `${hash}1` }).shouldResurrect).toBe(true)
  })

  it("E13 #given zero conclusions #when invoked #then no decay or resurrection happens", async () => {
    const s = "s13"
    storeVerdict(`${s}:c1`, { allow: true, proofArtifact: { theory: {}, result: { semantics: "preferred", extensions: [], conclusions: {} } } })
    await createEpistemicStateInterpreterHook(CONFIG)["tool.execute.before"](input(s, "c1"), output())
    await sleep()
    expect(snapshot(s)).toEqual({})
  })

  it("E14 #given excluded state #when decay runs #then it stays excluded", () => {
    expect(computeDecay({ currentState: "excluded", lastSeenInvocation: 0, currentInvocation: 1000, decayThreshold: 1 })).toEqual({ newState: "excluded", decayed: false })
  })

  it("E15 #given 200 decay checks #when run #then completes under 50ms", () => {
    const start = Date.now()
    for (let i = 0; i < 200; i++) {
      computeDecay({ currentState: i % 2 === 0 ? "accepted" : "plausible", lastSeenInvocation: i < 50 ? 0 : 999, currentInvocation: 1000, decayThreshold: 50 })
    }
    expect(Date.now() - start).toBeLessThan(50)
  })
})
