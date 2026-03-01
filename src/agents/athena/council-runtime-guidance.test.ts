import { describe, expect, it } from "bun:test"
import { resolveCouncilIntent, buildAthenaRuntimeGuidance, getValidCouncilIntents } from "./council-runtime-guidance"

describe("council-runtime-guidance", () => {
  describe("resolveCouncilIntent", () => {
    describe("#given valid uppercase intents", () => {
      describe("#when called with each valid intent", () => {
        const validIntents = ["DIAGNOSE", "AUDIT", "PLAN", "EVALUATE", "EXPLAIN", "CREATE", "PERSPECTIVES", "FREEFORM"] as const

        for (const intent of validIntents) {
          it(`#then returns "${intent}" for "${intent}"`, () => {
            expect(resolveCouncilIntent(intent)).toBe(intent)
          })
        }
      })
    })

    describe("#given lowercase intents", () => {
      describe("#when called with lowercase versions", () => {
        it("#then normalizes 'diagnose' to 'DIAGNOSE'", () => {
          expect(resolveCouncilIntent("diagnose")).toBe("DIAGNOSE")
        })

        it("#then normalizes 'audit' to 'AUDIT'", () => {
          expect(resolveCouncilIntent("audit")).toBe("AUDIT")
        })

        it("#then normalizes 'freeform' to 'FREEFORM'", () => {
          expect(resolveCouncilIntent("freeform")).toBe("FREEFORM")
        })
      })
    })

    describe("#given mixed case intents", () => {
      describe("#when called with mixed case", () => {
        it("#then normalizes 'Audit' to 'AUDIT'", () => {
          expect(resolveCouncilIntent("Audit")).toBe("AUDIT")
        })

        it("#then normalizes 'DiAgNoSe' to 'DIAGNOSE'", () => {
          expect(resolveCouncilIntent("DiAgNoSe")).toBe("DIAGNOSE")
        })

        it("#then normalizes 'Perspectives' to 'PERSPECTIVES'", () => {
          expect(resolveCouncilIntent("Perspectives")).toBe("PERSPECTIVES")
        })
      })
    })

    describe("#given invalid inputs", () => {
      describe("#when called with an unrecognized intent", () => {
        it("#then returns null for 'INVALID'", () => {
          expect(resolveCouncilIntent("INVALID")).toBeNull()
        })

        it("#then returns null for 'COMPARISON'", () => {
          expect(resolveCouncilIntent("COMPARISON")).toBeNull()
        })
      })

      describe("#when called with undefined", () => {
        it("#then returns null", () => {
          expect(resolveCouncilIntent(undefined)).toBeNull()
        })
      })

      describe("#when called with empty string", () => {
        it("#then returns null", () => {
          expect(resolveCouncilIntent("")).toBeNull()
        })
      })
    })
  })

  describe("buildAthenaRuntimeGuidance", () => {
    describe("#given a valid intent", () => {
      describe("#when building guidance for DIAGNOSE", () => {
        it("#then wraps content in athena_runtime_guidance tags", () => {
          const result = buildAthenaRuntimeGuidance("DIAGNOSE")
          expect(result).toContain("<athena_runtime_guidance>")
          expect(result).toContain("</athena_runtime_guidance>")
        })

        it("#then contains the intent name", () => {
          const result = buildAthenaRuntimeGuidance("DIAGNOSE")
          expect(result).toContain("intent: DIAGNOSE")
        })

        it("#then contains DIAGNOSE-specific content about root cause", () => {
          const result = buildAthenaRuntimeGuidance("DIAGNOSE")
          expect(result).toContain("root cause")
        })
      })

      describe("#when building guidance for AUDIT", () => {
        it("#then contains the AUDIT intent name", () => {
          const result = buildAthenaRuntimeGuidance("AUDIT")
          expect(result).toContain("intent: AUDIT")
        })

        it("#then contains AUDIT-specific synthesis rules", () => {
          const result = buildAthenaRuntimeGuidance("AUDIT")
          expect(result).toContain("AUDIT synthesis")
        })
      })

      describe("#when building guidance for FREEFORM", () => {
        it("#then contains FREEFORM intent name", () => {
          const result = buildAthenaRuntimeGuidance("FREEFORM")
          expect(result).toContain("intent: FREEFORM")
        })

        it("#then contains FREEFORM-specific content", () => {
          const result = buildAthenaRuntimeGuidance("FREEFORM")
          expect(result).toContain("FREEFORM synthesis")
        })
      })

      describe("#when building guidance for each intent", () => {
        const allIntents = ["DIAGNOSE", "AUDIT", "PLAN", "EVALUATE", "EXPLAIN", "CREATE", "PERSPECTIVES", "FREEFORM"] as const

        for (const intent of allIntents) {
          it(`#then ${intent} guidance contains runtime_synthesis_rules`, () => {
            const result = buildAthenaRuntimeGuidance(intent)
            expect(result).toContain("runtime_synthesis_rules")
          })

          it(`#then ${intent} guidance contains runtime_action_paths`, () => {
            const result = buildAthenaRuntimeGuidance(intent)
            expect(result).toContain("runtime_action_paths")
          })

          it(`#then ${intent} guidance contains source: council_finalize`, () => {
            const result = buildAthenaRuntimeGuidance(intent)
            expect(result).toContain("source: council_finalize")
          })
        }
      })
    })
  })

  describe("getValidCouncilIntents", () => {
    describe("#given the function is called", () => {
      describe("#when retrieving valid intents", () => {
        it("#then returns an array of 8 intents", () => {
          const intents = getValidCouncilIntents()
          expect(intents).toHaveLength(8)
        })

        it("#then contains all expected intent values", () => {
          const intents = getValidCouncilIntents()
          expect(intents).toContain("DIAGNOSE")
          expect(intents).toContain("AUDIT")
          expect(intents).toContain("PLAN")
          expect(intents).toContain("EVALUATE")
          expect(intents).toContain("EXPLAIN")
          expect(intents).toContain("CREATE")
          expect(intents).toContain("PERSPECTIVES")
          expect(intents).toContain("FREEFORM")
        })

        it("#then returns a readonly array", () => {
          const intents1 = getValidCouncilIntents()
          const intents2 = getValidCouncilIntents()
          expect(intents1).toBe(intents2)
        })
      })
    })
  })
})
