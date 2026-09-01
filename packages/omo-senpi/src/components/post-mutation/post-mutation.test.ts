import { describe, expect, it } from "bun:test"

import {
  MUTATION_TOOL_NAMES,
  createPostMutationSessionState,
  extractMutatedFilePaths,
  runSingleFlight,
} from "./post-mutation"

const event = (input: Record<string, unknown>, toolName = "apply_patch") => ({
  toolCallId: "1",
  toolName,
  input,
  content: [],
  isError: false,
})

describe("shared post-mutation primitives", () => {
  it("extracts all files from an apply_patch result and centralizes mutation names", () => {
    expect(MUTATION_TOOL_NAMES).toEqual(new Set(["write", "edit", "apply_patch"]))
    expect(extractMutatedFilePaths(event({
      input: "*** Begin Patch\n*** Update File: a.ts\n*** Add File: b.ts\n*** End Patch",
      files: [{ filePath: "c.ts", movePath: "d.ts" }],
    }))).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"])
  })

  it("coalesces duplicate in-flight paths", async () => {
    let runs = 0
    const first = runSingleFlight("a.ts", async () => {
      runs += 1
      await Promise.resolve()
      return 42
    })
    const second = runSingleFlight("a.ts", async () => {
      runs += 1
      return 7
    })
    expect(await Promise.all([first, second])).toEqual([42, 42])
    expect(runs).toBe(1)
  })

  it("tracks one notice per session and resets on a new session", () => {
    const state = createPostMutationSessionState()
    expect(state.shouldNotice("missing:biome", "s1")).toBe(true)
    expect(state.shouldNotice("missing:biome", "s1")).toBe(false)
    expect(state.shouldNotice("missing:biome", "s2")).toBe(true)
  })
})
