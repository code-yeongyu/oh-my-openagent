import { describe, expect, test } from "bun:test"

import { NUDGE_HINT_MAX_CHARS, type RecallNudge } from "@oh-my-opencode/memory-core"

import { createKibitzerNudgeTool, KIBITZER_NUDGE_TOOL_NAME } from "./kibitzer-nudge-tool"

const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
const HINT = "Drain nodes before a rollout."

/** The candidate set deliberately includes a system/ path: the closure must refuse it even when a
 * buggy collector offers one. */
const CANDIDATES = new Set([CANDIDATE_PATH, "notes/quiet.md", "system/persona.md"])

interface Launch {
  readonly accepted: RecallNudge[]
}

function launch(overrides: Partial<Parameters<typeof createKibitzerNudgeTool>[0]> = {}): Launch & {
  readonly tool: ReturnType<typeof createKibitzerNudgeTool>
} {
  const accepted: RecallNudge[] = []
  const tool = createKibitzerNudgeTool({
    candidates: CANDIDATES,
    surfaced: new Set<string>(),
    maxItems: 2,
    ...overrides,
    accepted,
  })
  return { accepted, tool }
}

function params(path: string, hint: string): { readonly path: string; readonly hint: string } {
  return { path, hint }
}

describe("createKibitzerNudgeTool", () => {
  test("#given a valid candidate and hint #when nudge is called #then the nudge is recorded and a short success text returns", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params(CANDIDATE_PATH, HINT))

    // then
    expect(result.isError).toBeUndefined()
    expect(result.content.find((part) => part.type === "text")?.text).toContain(CANDIDATE_PATH)
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint: HINT }])
  })

  test("#given a path outside the candidate set #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params("notes/never-offered.md", HINT))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test("#given a path already surfaced this session #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch({ surfaced: new Set(["notes/quiet.md"]) })

    // when
    const result = await tool.execute("call-1", params("notes/quiet.md", HINT))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test("#given a system path among the candidates #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params("system/persona.md", HINT))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test("#given a blank hint #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params(CANDIDATE_PATH, ""))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test("#given a hint over the character budget #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params(CANDIDATE_PATH, "x".repeat(NUDGE_HINT_MAX_CHARS + 1)))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test("#given a secret-bearing hint #when nudge is called #then an error result names the secret rule and nothing is recorded", async () => {
    const { tool, accepted } = launch()
    const result = await tool.execute("call-1", { path: CANDIDATE_PATH, hint: "Use AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE." })
    expect(result.isError).toBe(true)
    const first = result.content[0]
    expect(first?.type).toBe("text")
    if (first?.type === "text") expect(first.text).toContain("secret-like material")
    expect(accepted).toEqual([])
  })

  for (const [label, hint] of [
    ["password assignment", "password=hunter2"],
    ["bearer authorization", "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc"],
    ["OpenAI key", "sk-proj-AAAABBBBCCCCDDDD"],
  ] as const) {
    test(`#given a ${label} hint #when nudge is called #then an error result returns and nothing is recorded`, async () => {
      const { accepted, tool } = launch()
      const result = await tool.execute("call-1", params(CANDIDATE_PATH, hint))
      expect(result.isError).toBe(true)
      expect(accepted).toEqual([])
    })
  }

  test("#given a multiline hint #when nudge is called #then an error result returns and nothing is recorded", async () => {
    // given
    const { accepted, tool } = launch()

    // when
    const result = await tool.execute("call-1", params(CANDIDATE_PATH, "line one\nline two"))

    // then
    expect(result.isError).toBe(true)
    expect(accepted).toEqual([])
  })

  test.each([
    "No stored memory clears the bar for this planning step; the transcript already contains the full methodology, QA approach, and rollout.",
    "This memory covers OAuth login prompts and remote-test helpers, not the goal continuation timer delay.",
  ])("#given a meta hint %s #when nudge is called #then it is rejected and a factual correction can still use the cap", async (hint) => {
    const { accepted, tool } = launch({ maxItems: 1 })

    const rejected = await tool.execute("call-meta", params(CANDIDATE_PATH, hint))
    expect(rejected.isError).toBe(true)
    expect(accepted).toEqual([])

    const corrected = await tool.execute("call-fact", params(CANDIDATE_PATH, HINT))
    expect(corrected.isError).toBeUndefined()
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint: HINT }])
  })

  test.each([
    "The fix is on senpi main, not the extension.",
    "senpi monitors have a verified two-flag desync where registry.paused can remain set.",
    "The regression test does not cover Windows process cleanup.",
    "The outage is unrelated to the database migration.",
  ])("#given a factual hint %s #when nudge is called #then it is accepted unchanged", async (hint) => {
    const { accepted, tool } = launch()
    const result = await tool.execute("call-fact", params(CANDIDATE_PATH, hint))

    expect(result.isError).toBeUndefined()
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint }])
  })

  test("#given the maxItems budget already spent #when nudge is called again #then an error result returns and the accepted set is unchanged", async () => {
    // given
    const { accepted, tool } = launch({ maxItems: 1 })
    const first = await tool.execute("call-1", params(CANDIDATE_PATH, HINT))
    expect(first.isError).toBeUndefined()

    // when
    const second = await tool.execute("call-2", params("notes/quiet.md", HINT))

    // then
    expect(second.isError).toBe(true)
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint: HINT }])
  })

  test("#given the tool definition #when inspected #then it keeps the subprocess extension's name and contract", () => {
    // given
    const { tool } = launch()

    // when / then
    expect(tool.name).toBe(KIBITZER_NUDGE_TOOL_NAME)
    expect(tool.label).toBe("Kibitzer")
    expect(tool.description).toContain("read-only hint")
    expect(JSON.stringify(tool.parameters)).toContain("\"path\"")
    expect(JSON.stringify(tool.parameters)).toContain("\"hint\"")
  })
})
