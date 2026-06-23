import { describe, expect, it, mock } from "bun:test"
import { createMultiSemanticsComparator } from "./multi-semantics-comparator"

describe("createMultiSemanticsComparator", () => {
  it("#when semantics calls settle #then returns fulfilled extensions and certainty gradient", async () => {
    const argue = mock(async (request: { semantics: string }) => {
      if (request.semantics === "grounded") {
        return {
          extensions: [{ index: 0, accepted_conclusions: ["select_a", "shared"] }],
        }
      }

      if (request.semantics === "preferred") {
        return {
          result: {
            extensions: [
              { index: 0, accepted_conclusions: ["select_a", "shared", "defensible_only"] },
              { index: 1, accepted_conclusions: ["shared", "alternative_path"] },
            ],
          },
        }
      }

      if (request.semantics === "stable") {
        throw new Error("stable unavailable")
      }

      return {
        extensions: [{ index: 0, accepted_conclusions: ["shared", "contested_only"] }],
      }
    })

    const comparator = createMultiSemanticsComparator({ argue })
    const theory = { premises: [{ formula: "p", kind: "ordinary" }] }

    const result = await comparator.compare(theory)

    expect(argue.mock.calls.map(([request]) => request.semantics)).toEqual([
      "grounded",
      "preferred",
      "stable",
      "complete",
    ])
    expect(result.grounded_set).toEqual(["select_a", "shared"])
    expect(result.preferred_extensions).toEqual([
      ["select_a", "shared", "defensible_only"],
      ["shared", "alternative_path"],
    ])
    expect(result.stable_extensions).toEqual([])
    expect(result.complete_extensions).toEqual([["shared", "contested_only"]])
    expect(result.certainty_gradient).toEqual({
      certain: ["select_a", "shared"],
      defensible: ["alternative_path", "defensible_only"],
      contested: ["contested_only"],
    })
  })
})
