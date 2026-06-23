import { describe, expect, it } from "bun:test"
import { PremiseSchema, TheorySchema } from "./schemas"

describe("PremiseSchema kinds", () => {
  describe("#given kind axiom", () => {
    it("#when parsed #then accepts", () => {
      expect(PremiseSchema.parse({ formula: "charter_rule", kind: "axiom" }).kind).toBe("axiom")
    })
  })

  describe("#given kind assumption", () => {
    it("#when parsed #then accepts", () => {
      expect(PremiseSchema.parse({ formula: "estimate_78pct", kind: "assumption" }).kind).toBe("assumption")
    })
  })

  describe("#given no kind", () => {
    it("#when parsed #then defaults to ordinary", () => {
      expect(PremiseSchema.parse({ formula: "fact" }).kind).toBe("ordinary")
    })
  })

  describe("#given invalid kind", () => {
    it("#when parsed #then rejects", () => {
      expect(() => PremiseSchema.parse({ formula: "p", kind: "defeasible_premise" })).toThrow()
    })
  })
})

describe("TheorySchema", () => {
  describe("#given grouped preferences object", () => {
    it("#when parsed #then accepts ordered groups", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        preferences: {
          groups: [
            {
              group_id: "g1",
              ordered_rules: ["d1", "d2"],
            },
          ],
        },
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.data.preferences).toEqual({
        groups: [
          {
            group_id: "g1",
            ordered_rules: ["d1", "d2"],
            relation_to_other_groups: "unordered",
          },
        ],
      })
    })
  })

  describe("#given mixed preferences object", () => {
    it("#when parsed #then accepts pairwise and groups together", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        preferences: {
          pairwise: [{ superior: "d1", inferior: "d2" }],
          groups: [
            {
              group_id: "g1",
              ordered_rules: ["d1", "d2", "d3"],
              relation_to_other_groups: "superior",
            },
          ],
        },
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.data.preferences).toEqual({
        pairwise: [{ superior: "d1", inferior: "d2" }],
        groups: [
          {
            group_id: "g1",
            ordered_rules: ["d1", "d2", "d3"],
            relation_to_other_groups: "superior",
          },
        ],
      })
    })
  })

  describe("#given empty premises array", () => {
    it("#when parsed #then rejects", () => {
      const result = TheorySchema.safeParse({ premises: [] })

      expect(result.success).toBe(false)
    })
  })

  describe("#given missing premises field", () => {
    it("#when parsed #then rejects", () => {
      const result = TheorySchema.safeParse({})

      expect(result.success).toBe(false)
    })
  })

  describe("#given valid minimal theory (1 premise, no rules)", () => {
    it("#when parsed #then accepts", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)" }],
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.data.premises).toHaveLength(1)
      expect(result.data.premises[0]?.kind).toBe("ordinary")
      expect(result.data.classical_negation).toBe(true)
    })
  })

  describe("#given full theory with strict rules, defeasible rules, preferences", () => {
    it("#when parsed #then accepts", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [{ id: "s1", antecedents: ["problem(current)"], consequent: "must(check)" }],
        defeasible_rules: [{ id: "d1", name: "ship_preference", antecedents: ["problem(current)"], consequent: "prefer(ship)" }],
        preferences: [{ superior: "d1", inferior: "d2" }],
        contraries: [["prefer(ship)", "must(wait)"]],
        classical_negation: true,
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.data.strict_rules).toHaveLength(1)
      expect(result.data.defeasible_rules).toHaveLength(1)
      expect(result.data.defeasible_rules?.[0]?.name).toBe("ship_preference")
      expect(result.data.preferences).toHaveLength(1)
      expect(result.data.contraries).toEqual([["prefer(ship)", "must(wait)"]])
    })
  })

  describe("#given theory with contraries", () => {
    it("#when parsed #then accepts contrary pairs", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)" }],
        strict_rules: [{ id: "s1", antecedents: ["problem(current)"], consequent: "must(review)" }],
        contraries: [["problem(current)", "must(review)"]],
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.data.contraries).toEqual([["problem(current)", "must(review)"]])
    })
  })

  describe("#given classical_negation explicitly false", () => {
    it("#when parsed #then rejects per ASPIC+ contract", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)" }],
        classical_negation: false,
      })

      expect(result.success).toBe(false)
      if (result.success) return

      const issue = result.error.issues.find((i) =>
        /classical_negation must be true/.test(i.message),
      )
      expect(issue).toBeDefined()
    })
  })

  describe("#given classical_negation field omitted (migration shim)", () => {
    it("#when parsed #then defaults to true without warning", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)" }],
      })

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.classical_negation).toBe(true)
    })
  })

  describe("#given classical_negation explicitly true", () => {
    it("#when parsed #then accepts", () => {
      const result = TheorySchema.safeParse({
        premises: [{ formula: "problem(current)" }],
        classical_negation: true,
      })

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.classical_negation).toBe(true)
    })
  })
})
