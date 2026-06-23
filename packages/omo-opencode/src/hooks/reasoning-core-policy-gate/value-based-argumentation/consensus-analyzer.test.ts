/// <reference path="../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { analyzeAudienceConsensus } from "./consensus-analyzer"

describe("analyzeAudienceConsensus", () => {
  it("#when all extensions match #then consensus is unanimous", () => {
    const consensus = analyzeAudienceConsensus([
      { audience_id: "a", extension_signature: "select_option_b" },
      { audience_id: "b", extension_signature: "select_option_b" },
    ])

    expect(consensus).toBe("unanimous")
  })

  it("#when one extension has more than half #then consensus is majority", () => {
    const consensus = analyzeAudienceConsensus([
      { audience_id: "a", extension_signature: "select_option_b" },
      { audience_id: "b", extension_signature: "select_option_b" },
      { audience_id: "c", extension_signature: "select_option_a" },
    ])

    expect(consensus).toBe("majority")
  })

  it("#when no extension has more than half #then consensus is split", () => {
    const consensus = analyzeAudienceConsensus([
      { audience_id: "a", extension_signature: "select_option_a" },
      { audience_id: "b", extension_signature: "select_option_b" },
      { audience_id: "c", extension_signature: "select_option_c" },
    ])

    expect(consensus).toBe("split")
  })
})
