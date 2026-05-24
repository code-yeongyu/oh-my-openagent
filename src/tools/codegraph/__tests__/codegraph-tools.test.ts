import { describe, it, expect } from "bun:test"
import { createCodeGraphTools } from "../tools"
describe("createCodeGraphTools", () => {
  const mock = { getStatus: () => ({ isAvailable: false, isInitialized: false, fileCount: 0, nodeCount: 0, edgeCount: 0, errorMessage: "nope", indexPath: null }), ensureIndex: async () => false } as any
  it("returns 2 tools", () => { expect(Object.keys(createCodeGraphTools(mock))).toHaveLength(2) })
  it("tool names correct", () => { expect(Object.keys(createCodeGraphTools(mock))).toEqual(["codegraph_status", "codegraph_ensure_index"]) })
})
