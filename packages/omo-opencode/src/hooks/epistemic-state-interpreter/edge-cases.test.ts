import { afterEach, describe, expect, it } from "bun:test"
import { createEpistemicStateInterpreterHook } from "./hook"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"
import { _resetForTesting as resetAnnotationStore, getAnnotations, clearAnnotations } from "./annotation-store"
import { clearSession } from "./verdict-store"

const ENABLED_CONFIG = { epistemic_state_interpreter_enabled: true }

const makeInput = (sessionID = "s1", callID = "c1") => ({
  tool: "bash",
  sessionID,
  callID,
})

const makeOutput = () => ({ args: {} })

afterEach(() => {
  resetVerdictStore()
  resetAnnotationStore()
})

describe("Edge Cases E1-E10", () => {
  it("E1: proofArtifact is undefined #then no annotations, no throw", async () => {
    storeVerdict("s1:c1", { allow: true, proofArtifact: undefined })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await expect(hook["tool.execute.before"](makeInput(), makeOutput())).resolves.toBeUndefined()
    expect(getAnnotations("s1")).toHaveLength(0)
  })

  it("E2: proofArtifact is malformed string #then no annotations, no throw", async () => {
    storeVerdict("s1:c1", { allow: true, proofArtifact: "not-an-object" })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await expect(hook["tool.execute.before"](makeInput(), makeOutput())).resolves.toBeUndefined()
    expect(getAnnotations("s1")).toHaveLength(0)
  })

  it("E3: conclusions map is empty #then no annotations produced", async () => {
    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: { semantics: "preferred", extensions: [{ index: 0, accepted_conclusions: [] }], conclusions: {} },
      },
    })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await hook["tool.execute.before"](makeInput(), makeOutput())
    expect(getAnnotations("s1")).toHaveLength(0)
  })

  it("E4: zero extensions #then all conclusions classified as open", async () => {
    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [],
          conclusions: {
            "some_conclusion(x)": {
              conclusion: "some_conclusion(x)",
              status: "Accepted",
              proof_chain: [{ conclusion: "some_conclusion(x)", from: [], rule_id: "d1", rule_kind: "defeasible" }],
            },
          },
        },
      },
    })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await hook["tool.execute.before"](makeInput(), makeOutput())
    const annotations = getAnnotations("s1")
    const c = annotations.find((a) => a.conclusion === "some_conclusion(x)")
    expect(c?.state).toBe("open")
  })

  it("E5: conclusion in some but not all extensions #then classified per ratio", async () => {
    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [
            { index: 0, accepted_conclusions: ["c(x)"] },
            { index: 1, accepted_conclusions: [] },
          ],
          conclusions: {
            "c(x)": {
              conclusion: "c(x)",
              status: "Undecided",
              proof_chain: [{ conclusion: "c(x)", from: [], rule_id: "d1", rule_kind: "defeasible" }],
            },
          },
        },
      },
    })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await hook["tool.execute.before"](makeInput(), makeOutput())
    const annotation = getAnnotations("s1").find((a) => a.conclusion === "c(x)")
    expect(annotation?.state).toBe("open")
    expect(annotation?.extensionMembership.inCount).toBe(1)
    expect(annotation?.extensionMembership.totalCount).toBe(2)
  })

  it("E6: proof chain with both strict and defeasible #then kind is mixed", async () => {
    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: ["c(x)"] }],
          conclusions: {
            "c(x)": {
              conclusion: "c(x)",
              status: "Accepted",
              proof_chain: [
                { conclusion: "p1(x)", from: [], rule_id: "s1", rule_kind: "strict" },
                { conclusion: "c(x)", from: ["p1(x)"], rule_id: "d1", rule_kind: "defeasible" },
              ],
            },
          },
        },
      },
    })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await hook["tool.execute.before"](makeInput(), makeOutput())
    const annotation = getAnnotations("s1").find((a) => a.conclusion === "c(x)")
    expect(annotation?.proofChainKind).toBe("mixed")
  })

  it("E7: no verdict stored (policy gate threw) #then hook skips gracefully", async () => {
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    const input = makeInput("s-no-verdict", "c1")
    await expect(hook["tool.execute.before"](input, makeOutput())).resolves.toBeUndefined()
    expect(getAnnotations("s-no-verdict")).toHaveLength(0)
  })

  it("E8: empty proof_chain (only ordinary steps) #then kind is unknown", async () => {
    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: ["p(x)"] }],
          conclusions: {
            "p(x)": {
              conclusion: "p(x)",
              status: "Accepted",
              proof_chain: [{ conclusion: "p(x)", from: [], rule_id: null, rule_kind: "ordinary" }],
            },
          },
        },
      },
    })
    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    await hook["tool.execute.before"](makeInput(), makeOutput())
    const annotation = getAnnotations("s1").find((a) => a.conclusion === "p(x)")
    expect(annotation?.proofChainKind).toBe("unknown")
  })

  it("E9: large proofArtifact (50 conclusions) #then completes under 5ms", async () => {
    const conclusions: Record<string, unknown> = {}
    const acceptedConclusions: string[] = []
    for (let i = 0; i < 50; i++) {
      const key = `conclusion_${i}(x)`
      conclusions[key] = {
        conclusion: key,
        status: i % 3 === 0 ? "Rejected" : "Accepted",
        proof_chain: [{ conclusion: key, from: [], rule_id: `d${i}`, rule_kind: i % 2 === 0 ? "defeasible" : "strict" }],
      }
      if (i % 3 !== 0) acceptedConclusions.push(key)
    }

    storeVerdict("s1:c1", {
      allow: true,
      proofArtifact: {
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: acceptedConclusions }],
          conclusions,
        },
      },
    })

    const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
    const start = performance.now()
    await hook["tool.execute.before"](makeInput(), makeOutput())
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5)
    expect(getAnnotations("s1").length).toBe(50)
  })

  it("E10: session cleanup removes annotations #then getAnnotations returns empty", () => {
    const fakeAnnotations = [
      {
        conclusion: "c(x)",
        state: "accepted" as const,
        rawClassification: "accepted" as const,
        reason: "test",
        timestamp: 0,
        callID: "",
        proofChainKind: "strict" as const,
        extensionMembership: { inCount: 1, totalCount: 1 },
      },
    ]
    // Store via annotation-store directly and verify clearAnnotations removes them
    const { storeAnnotations } = require("./annotation-store")
    storeAnnotations("s-to-clear", fakeAnnotations)
    expect(getAnnotations("s-to-clear")).toHaveLength(1)

    clearAnnotations("s-to-clear")
    expect(getAnnotations("s-to-clear")).toHaveLength(0)
  })
})
