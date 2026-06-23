import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { getAnnotations, _resetForTesting as resetAnnotationStore } from "./annotation-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import { _resetForTesting as resetHistoryStore } from "./history-store"
import * as persistenceModule from "./persistence"
import * as transitionEngineModule from "./transition-engine"
import type { EpistemicState } from "./types"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"

const ENABLED_CONFIG = { epistemic_state_interpreter_enabled: true }
const SESSION_ID = "session-v2"

function buildConclusion(status: string, ruleKind: "strict" | "defeasible") {
  return {
    conclusion: "",
    status,
    proof_chain: [
      {
        conclusion: "support",
        from: [],
        rule_id: ruleKind === "strict" ? "s1" : "d1",
        rule_kind: ruleKind,
      },
    ],
  }
}

function buildProofArtifact(
  definitions: Array<{
    conclusion: string
    status: string
    ruleKind: "strict" | "defeasible"
    inExtensions?: number
    totalExtensions?: number
  }>,
) {
  const extensions = definitions.reduce<Array<{ index: number; accepted_conclusions: string[] }>>((result, definition) => {
    const count = definition.inExtensions ?? 1
    const totalExtensions = definition.totalExtensions ?? count
    for (let index = 0; index < totalExtensions; index += 1) {
      if (!result[index]) {
        result[index] = { index, accepted_conclusions: [] }
      }
      if (index < count) {
        result[index]?.accepted_conclusions.push(definition.conclusion)
      }
    }
    return result
  }, [])

  return {
    theory: {},
    result: {
      semantics: "preferred",
      extensions,
      conclusions: Object.fromEntries(
        definitions.map((definition) => [
          definition.conclusion,
          {
            ...buildConclusion(definition.status, definition.ruleKind),
            conclusion: definition.conclusion,
          },
        ]),
      ),
    },
  }
}

async function invoke(
  callID: string,
  definitions: Array<{
    conclusion: string
    status: string
    ruleKind: "strict" | "defeasible"
    inExtensions?: number
    totalExtensions?: number
  }>,
) {
  storeVerdict(`${SESSION_ID}:${callID}`, {
    allow: true,
    proofArtifact: buildProofArtifact(definitions),
  })

  const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
  await hook["tool.execute.before"]({ tool: "bash", sessionID: SESSION_ID, callID }, { args: {} })
}

afterEach(() => {
  resetVerdictStore()
  resetAnnotationStore()
  resetHistoryStore()
})

describe("V2 hook integration", () => {
  it("#given no disk data or history #when invoked #then first annotation stays at raw classification", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})

    await invoke("c1", [{ conclusion: "claim-1", status: "Undecided", ruleKind: "strict" }])

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(getAnnotations(SESSION_ID)).toEqual([
      expect.objectContaining({ conclusion: "claim-1", rawClassification: "open", state: "open" }),
    ])

    loadSpy.mockRestore()
    persistSpy.mockRestore()
  })

  it("#given two consecutive identical classifications #when threshold is not met #then state remains unchanged", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})

    await invoke("c1", [{ conclusion: "claim-1", status: "Undecided", ruleKind: "strict" }])
    await invoke("c2", [{ conclusion: "claim-1", status: "Undecided", ruleKind: "strict" }])

    const annotations = getAnnotations(SESSION_ID)
    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledTimes(2)
    expect(annotations).toHaveLength(2)
    expect(annotations[1]).toEqual(expect.objectContaining({ rawClassification: "open", state: "open" }))

    loadSpy.mockRestore()
    persistSpy.mockRestore()
  })

  it("#given three conclusions #when invoked repeatedly #then each conclusion evolves independently", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})

    const definitions = [
      { conclusion: "claim-open", status: "Undecided", ruleKind: "strict" as const },
      { conclusion: "claim-accepted", status: "Accepted", ruleKind: "strict" as const },
      { conclusion: "claim-excluded", status: "Rejected", ruleKind: "strict" as const },
    ]

    await invoke("c1", definitions)
    await invoke("c2", definitions)
    await invoke("c3", definitions)

    const latest = new Map<string, EpistemicState>()
    for (const annotation of getAnnotations(SESSION_ID)) {
      latest.set(annotation.conclusion, annotation.state)
    }

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledTimes(3)
    expect(latest.get("claim-open")).toBe("open")
    expect(latest.get("claim-accepted")).toBe("accepted")
    expect(latest.get("claim-excluded")).toBe("excluded")

    loadSpy.mockRestore()
    persistSpy.mockRestore()
  })

  it("#given 50 conclusions #when invoked #then completes under 10ms", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})
    const definitions = Array.from({ length: 50 }, (_, index) => ({
      conclusion: `claim-${index}`,
      status: "Accepted",
      ruleKind: "strict" as const,
    }))

    const startedAt = performance.now()
    await invoke("c1", definitions)
    const elapsed = performance.now() - startedAt

    expect(elapsed).toBeLessThan(10)
    expect(getAnnotations(SESSION_ID)).toHaveLength(50)

    loadSpy.mockRestore()
    persistSpy.mockRestore()
  })

  it("#given transition engine failure #when invoked #then hook catches and returns", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})
    const transitionSpy = spyOn(transitionEngineModule, "computeTransition").mockImplementation(() => {
      throw new Error("simulated transition failure")
    })

    await invoke("c1", [{ conclusion: "claim-1", status: "Undecided", ruleKind: "strict" }])
    expect(getAnnotations(SESSION_ID)).toHaveLength(0)

    loadSpy.mockRestore()
    persistSpy.mockRestore()
    transitionSpy.mockRestore()
  })

  it("#given repeated plausible classifications after an open start #when threshold is reached #then state evolves through T1", async () => {
    const loadSpy = spyOn(persistenceModule, "loadPersistedState").mockReturnValue(null)
    const persistSpy = spyOn(persistenceModule, "persistState").mockImplementation(() => {})

    await invoke("c1", [{ conclusion: "claim-1", status: "Undecided", ruleKind: "strict" }])
    await invoke("c2", [{ conclusion: "claim-1", status: "Accepted", ruleKind: "defeasible" }])
    await invoke("c3", [{ conclusion: "claim-1", status: "Accepted", ruleKind: "defeasible" }])
    await invoke("c4", [{ conclusion: "claim-1", status: "Accepted", ruleKind: "defeasible" }])

    const states = getAnnotations(SESSION_ID).map((annotation) => annotation.state)
    expect(states).toEqual(["open", "open", "open", "plausible"])

    loadSpy.mockRestore()
    persistSpy.mockRestore()
  })
})
