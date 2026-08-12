import { afterEach, describe, expect, test } from "bun:test"

import {
  HISTORY_MAX_COMMITS,
  HISTORY_PER_DIFF_CAP,
  HISTORY_TOTAL_PAYLOAD_CAP,
  REFLECTION_COMMIT_PATTERN,
  collectHistory,
} from "./history-collector"
import {
  cleanupPalaceFixtures,
  commitPalaceFile,
  createPalaceFixture,
} from "./palace.test-support"

afterEach(cleanupPalaceFixtures)

describe("palace history collector", () => {
  test("#given reflection and ordinary commits #when history is collected #then reflection commits are tagged and caps are declared", async () => {
    const fixture = await createPalaceFixture()
    await commitPalaceFile(fixture, "system/learned.md", "---\ndescription: learned\n---\n\nlearned thing\n", "feat(reflection): capture learned thing")

    const history = await collectHistory(fixture.repo)

    expect(history.commits.length).toBeGreaterThanOrEqual(2)
    const reflection = history.commits.find((commit) => commit.subject.startsWith("feat(reflection)"))
    expect(reflection?.isReflection).toBe(true)
    expect(reflection?.diff).toContain("learned thing")
    expect(history.commits.filter((commit) => commit.isReflection)).toHaveLength(1)
    expect(history.caps).toEqual({
      maxCommits: HISTORY_MAX_COMMITS,
      perDiffBytes: HISTORY_PER_DIFF_CAP,
      totalDiffBytes: HISTORY_TOTAL_PAYLOAD_CAP,
    })
  }, 30_000)

  test("#given merge and chore reflection subjects #when matched against the reflection pattern #then only reflection-scoped commits match", () => {
    expect(REFLECTION_COMMIT_PATTERN.test("feat(reflection): learn")).toBe(true)
    expect(REFLECTION_COMMIT_PATTERN.test("fix(reflection): repair")).toBe(true)
    expect(REFLECTION_COMMIT_PATTERN.test("chore(reflection): prune")).toBe(true)
    expect(REFLECTION_COMMIT_PATTERN.test("merge(reflection): run 12")).toBe(true)
    expect(REFLECTION_COMMIT_PATTERN.test("feat(memory): unrelated")).toBe(false)
    expect(REFLECTION_COMMIT_PATTERN.test("docs: mentions reflection later")).toBe(false)
  })
})
