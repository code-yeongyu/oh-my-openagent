import { afterEach, describe, expect, mock, test } from "bun:test"

import { storeAnnotations, clearAnnotations } from "./annotation-store"
import { clearMultiPlaneStore, storeMultiPlaneAnnotations } from "./annotation-store-v2"
import type { MultiPlaneAnnotation } from "./multi-plane-types"
import { createPreferenceInjectionHook } from "./preference-injection-hook"
import {
  _clearInMemoryPreferenceStoreForTesting,
  clearPreferences,
  getPreferences,
  storePreference,
} from "./preference-store"
import type { EpistemicAnnotation } from "./types"

const SESSION_ID = "session-preference-injection"
const CONFIG = {
  preference_weights: {
    logico: 0.6,
    probabilistico: 0.4,
    etico: 0,
    pragmatico: 0,
    morale: 0,
  },
}

function createAnnotation(
  conclusion: string,
  proofChainKind: EpistemicAnnotation["proofChainKind"],
  inCount: number,
  totalCount: number,
  callID = "call-1"
): EpistemicAnnotation {
  return {
    conclusion,
    state: "accepted",
    rawClassification: "accepted",
    reason: `${conclusion}-reason`,
    timestamp: 1,
    callID,
    proofChainKind,
    extensionMembership: { inCount, totalCount },
  }
}

afterEach(() => {
  clearAnnotations(SESSION_ID)
  clearMultiPlaneStore(SESSION_ID)
  clearPreferences(SESSION_ID)
})

function createMultiPlaneAnnotation(
  conclusion: string,
  combined: number,
): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: combined, plausibile: true },
      pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: `${conclusion}-reason`,
    timestamp: 1,
    callID: "call-mp",
    proofChainKind: "mixed",
    extensionMembership: { inCount: 1, totalCount: 1 },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: combined, label: "lecito", allineamento_legale: combined, valore_empatico: combined, magnitudine_beneficio: combined, override: false, reason: null },
      pragmatico: { score: combined, label: "conveniente", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0, costo_controparte: 0, pesatura: { proprio: 0.5, controparte: 0.5 } },
      morale: { score: combined, label: "giustificabile", contesto_sociale: "neutral", comprensione_destinatari: "medium", impatto_cascata: 0, intenzione: "benevola", trasparenza: combined, fiducia_risultante: combined, reason: null },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
  }
}

describe("createPreferenceInjectionHook", () => {
  describe("#given a non-reason_argue tool call", () => {
    test("#when executed #then it ignores the call", async () => {
      storePreference(SESSION_ID, { superior: "r1", inferior: "r2", strength: 0.8 })
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: { preferences: [] as Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: SESSION_ID, callID: "call-1" },
        output
      )

      expect(output.args.theory.preferences).toEqual([])
    })
  })

  describe("#given no stored preferences or annotations", () => {
    test("#when theory already has preferences #then they remain unchanged", async () => {
      const hook = createPreferenceInjectionHook(CONFIG)
      const existing = [{ superior: "s0", inferior: "d0" }]
      const output = { args: { theory: { preferences: existing.slice() } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-1" },
        output
      )

      expect(output.args.theory.preferences).toEqual(existing)
    })
  })

  describe("#given stored preferences", () => {
    test("#when theory has no existing preferences #then stored preferences are injected", async () => {
      storePreference(SESSION_ID, { superior: "s1", inferior: "d1", strength: 0.9 })
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-1" },
        output
      )

      expect(output.args.theory.preferences).toEqual([{ superior: "s1", inferior: "d1" }])
    })

    test("#when theory already has preferences #then they are preserved and appended", async () => {
      storePreference(SESSION_ID, { superior: "s1", inferior: "d1", strength: 0.9 })
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = {
        args: {
          theory: {
            preferences: [{ superior: "s0", inferior: "d0" }],
          },
        },
      }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-1" },
        output
      )

      expect(output.args.theory.preferences).toEqual([
        { superior: "s0", inferior: "d0" },
        { superior: "s1", inferior: "d1" },
      ])
    })
  })

  describe("#given annotations from a previous cycle", () => {
    test("#when executed #then it derives and stores preferences before injection", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("strict-win", "strict", 1, 1),
        createAnnotation("defeasible-loss", "defeasible", 0, 1),
      ])
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: { preferences: [] as Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-2" },
        output
      )

      expect(getPreferences(SESSION_ID).has("strict-win>defeasible-loss")).toBe(true)
      expect(output.args.theory.preferences).toContainEqual({
        superior: "strict-win",
        inferior: "defeasible-loss",
      })
    })

    test("#when annotations have equal combined strength #then no new preference is generated", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("equal-a", "mixed", 1, 2),
        createAnnotation("equal-b", "mixed", 1, 2),
      ])
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: { preferences: [] as Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-3" },
        output
      )

      expect(getPreferences(SESSION_ID).size).toBe(0)
      expect(output.args.theory.preferences).toEqual([])
    })
  })

  describe("#given a theory object without preferences", () => {
    test("#when stored preferences exist #then the preferences field is added", async () => {
      storePreference(SESSION_ID, { superior: "s1", inferior: "d1", strength: 0.9 })
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-4" },
        output
      )

      expect(output.args.theory.preferences).toEqual([{ superior: "s1", inferior: "d1" }])
    })
  })

  describe("#given args without a theory object", () => {
    test("#when executed #then it returns without throwing", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("strict-win", "strict", 1, 1),
        createAnnotation("defeasible-loss", "defeasible", 0, 1),
      ])
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: {} }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-5" },
        output
      )

      expect(getPreferences(SESSION_ID).has("strict-win>defeasible-loss")).toBe(true)
    })
  })

  describe("#given a reasoning-core client is provided", () => {
    test("#when annotations from the legacy path produce a preference #then kbAdd is called with prefer:support:legacy tag", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("strict-win", "strict", 1, 1),
        createAnnotation("defeasible-loss", "defeasible", 0, 1),
      ])
      const kbAdd = mock(async () => ({ id: "kb-1" }))
      const hook = createPreferenceInjectionHook(CONFIG, {
        client: { kbAdd } as unknown as Parameters<typeof createPreferenceInjectionHook>[1] extends infer T ? T extends { client: infer C } ? C : never : never,
      })

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-kb-legacy" },
        { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } },
      )

      expect(kbAdd).toHaveBeenCalled()
      const calls = kbAdd.mock.calls as unknown[][]
      const firstArg = calls[0]?.[0] as { layer: string; tags: string[]; content: { Preference: { superior: string; inferior: string } } }
      expect(firstArg.layer).toBe("Learned")
      expect(firstArg.tags).toContain("prefer:support:legacy")
      expect(firstArg.content).toEqual({
        Preference: { superior: "strict-win", inferior: "defeasible-loss" },
      })
    })

    test("#when annotations from the multi-plane path produce a preference #then kbAdd is called with prefer:support:multi-plane tag", async () => {
      storeMultiPlaneAnnotations(SESSION_ID, [
        createMultiPlaneAnnotation("alpha", 0.9),
        createMultiPlaneAnnotation("beta", 0.4),
      ])
      const kbAdd = mock(async () => ({ id: "kb-1" }))
      const hook = createPreferenceInjectionHook(CONFIG, {
        client: { kbAdd } as unknown as Parameters<typeof createPreferenceInjectionHook>[1] extends infer T ? T extends { client: infer C } ? C : never : never,
      })

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-kb-mp" },
        { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } },
      )

      expect(kbAdd).toHaveBeenCalled()
      const calls = kbAdd.mock.calls as unknown[][]
      const firstArg = calls[0]?.[0] as { layer: string; tags: string[]; content: { Preference: { superior: string; inferior: string } } }
      expect(firstArg.layer).toBe("Learned")
      expect(firstArg.tags).toContain("prefer:support:multi-plane")
      expect(firstArg.content).toEqual({
        Preference: { superior: "alpha", inferior: "beta" },
      })
    })

    test("#when kbAdd rejects #then derivation still completes and stored preference is injected", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("strict-win", "strict", 1, 1),
        createAnnotation("defeasible-loss", "defeasible", 0, 1),
      ])
      const kbAdd = mock(async () => {
        throw new Error("kb unavailable")
      })
      const hook = createPreferenceInjectionHook(CONFIG, {
        client: { kbAdd } as unknown as Parameters<typeof createPreferenceInjectionHook>[1] extends infer T ? T extends { client: infer C } ? C : never : never,
      })
      const output = { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-kb-error" },
        output,
      )

      expect(getPreferences(SESSION_ID).has("strict-win>defeasible-loss")).toBe(true)
      expect(output.args.theory.preferences).toContainEqual({
        superior: "strict-win",
        inferior: "defeasible-loss",
      })
    })
  })

  describe("#given multiple derived preferences from a single derivation cycle", () => {
    test("#when annotations produce N preferences #then kbAdd is invoked exactly N times with the same prefer:<kind>:<reason> prefix", async () => {
      storeMultiPlaneAnnotations(SESSION_ID, [
        createMultiPlaneAnnotation("alpha", 0.9),
        createMultiPlaneAnnotation("beta", 0.6),
        createMultiPlaneAnnotation("gamma", 0.3),
      ])
      const kbAdd = mock(async () => ({ id: "kb-1" }))
      const hook = createPreferenceInjectionHook(CONFIG, {
        client: { kbAdd } as unknown as Parameters<typeof createPreferenceInjectionHook>[1] extends infer T ? T extends { client: infer C } ? C : never : never,
      })

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-kb-multi" },
        { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } },
      )

      expect(kbAdd).toHaveBeenCalledTimes(3)
      const calls = kbAdd.mock.calls as unknown[][]
      for (const call of calls) {
        const entry = call[0] as { layer: string; tags: string[] }
        expect(entry.layer).toBe("Learned")
        expect(entry.tags.some((tag) => tag.startsWith("prefer:support:multi-plane"))).toBe(true)
      }
    })
  })

  describe("#given no reasoning-core client is provided", () => {
    test("#when annotations produce a preference #then derivation completes without attempting KB persistence", async () => {
      storeAnnotations(SESSION_ID, [
        createAnnotation("strict-win", "strict", 1, 1),
        createAnnotation("defeasible-loss", "defeasible", 0, 1),
      ])
      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-no-client" },
        output,
      )

      expect(getPreferences(SESSION_ID).has("strict-win>defeasible-loss")).toBe(true)
      expect(output.args.theory.preferences).toContainEqual({
        superior: "strict-win",
        inferior: "defeasible-loss",
      })
    })
  })

  describe("#given preferences were persisted before a simulated restart", () => {
    test("#when the hook runs after in-memory preferences are cleared #then disk preferences are injected", async () => {
      storePreference(SESSION_ID, { superior: "s-restart", inferior: "d-restart", strength: 0.9 })
      _clearInMemoryPreferenceStoreForTesting()

      const hook = createPreferenceInjectionHook(CONFIG)
      const output = { args: { theory: {} as { preferences?: Array<{ superior: string; inferior: string }> } } }
      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID: SESSION_ID, callID: "call-restart" },
        output
      )

      expect(output.args.theory.preferences).toContainEqual({
        superior: "s-restart",
        inferior: "d-restart",
      })
    })
  })
})
