import { describe, expect, test } from "bun:test"

import { normalizeAgentName } from "./agent-resolver"

describe("runtime fallback agent resolver", () => {
  test("resolves a configured custom display name to its agent key", () => {
    expect(normalizeAgentName("計畫師", {
      prometheus: { displayName: "計畫師" },
    })).toBe("prometheus")
  })
})
