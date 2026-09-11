import { describe, expect, test } from "bun:test"

import { normalizeTaskToolArguments } from "./argument-normalization"
import { buildStartSpec, singleSpawnParams } from "./execute-spec"
import { resolveSpawnItems } from "./validation"
import type { TaskToolDeps } from "./types"

function deps(): TaskToolDeps {
  return {
    manager: {} as TaskToolDeps["manager"],
    omoConfig: {},
    agents: {},
  }
}

describe("retain_transcript tool plumbing", () => {
  test("#given a single spawn with retain_transcript true #when the start spec is built #then the mark reaches the manager spec", () => {
    const spec = buildStartSpec(
      { prompt: "Run deep work", retain_transcript: true },
      { category: "deep" },
      "session-1",
      deps(),
      "/repo",
    )
    expect(spec.retain_transcript).toBe(true)
  })

  test("#given a single spawn with retain_transcript metadata #when the start spec is built #then the metadata-only mark reaches the manager spec", () => {
    const spec = buildStartSpec(
      { prompt: "Run protected clinical work", retain_transcript: "metadata" },
      { category: "deep" },
      "session-1",
      deps(),
      "/repo",
    )
    expect(spec.retain_transcript).toBe("metadata")
  })

  test("#given a single spawn without retain_transcript #when the start spec is built #then the mark stays absent", () => {
    const spec = buildStartSpec({ prompt: "Run work" }, { category: "quick" }, "session-1", deps(), "/repo")
    expect("retain_transcript" in spec).toBe(false)
  })

  test("#given raw arguments #when normalized #then top-level and item-level retention marks survive including metadata", () => {
    const normalized = normalizeTaskToolArguments({
      category: "deep",
      retain_transcript: "metadata",
      tasks: [
        { prompt: "a", retain_transcript: false },
        { prompt: "b" },
        { prompt: "c", retain_transcript: "metadata" },
      ],
    })
    expect(normalized.retain_transcript).toBe("metadata")
    expect(normalized.tasks?.[0]?.retain_transcript).toBe(false)
    expect(normalized.tasks?.[1]?.retain_transcript).toBeUndefined()
    expect(normalized.tasks?.[2]?.retain_transcript).toBe("metadata")
  })

  test("#given raw arguments with an invalid retention mark #when normalized #then the mark is dropped for the strict schema to reject", () => {
    const normalized = normalizeTaskToolArguments({ prompt: "x", retain_transcript: "full" })
    expect("retain_transcript" in normalized).toBe(false)
  })

  test("#given batch items #when spawn items resolve #then an item-level mark wins over the top-level mark and an absent item inherits it", () => {
    const result = resolveSpawnItems({
      category: "deep",
      retain_transcript: true,
      tasks: [
        { prompt: "a", retain_transcript: false },
        { prompt: "b" },
      ],
    })
    if (result.kind !== "ok") throw new Error("expected items to resolve")
    expect(result.items[0]?.retain_transcript).toBe(false)
    expect(result.items[1]?.retain_transcript).toBe(true)
  })

  test("#given resolved items #when single spawn params are derived #then the item mark is carried", () => {
    const params = singleSpawnParams(
      { prompt: "a", retain_transcript: false, kind: "category", category: "deep", load_skills: [] },
      undefined,
    )
    expect(params.retain_transcript).toBe(false)
  })
})
