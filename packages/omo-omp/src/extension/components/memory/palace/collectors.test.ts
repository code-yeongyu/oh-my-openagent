import { describe, expect, test } from "bun:test"

import {
  HISTORY_MAX_COMMITS,
  HISTORY_PER_DIFF_CAP,
  HISTORY_TOTAL_PAYLOAD_CAP,
  REFLECTION_COMMIT_PATTERN,
  collectCore,
  collectExternal,
  collectHistory,
  collectReflection,
} from "./collectors"
import {
  commitPalaceFile,
  createPalaceFixture,
  writePalaceWorkingFile,
} from "./palace.test-support"

describe("palace collectors", () => {
  test("#given a committed memory repo #when core entries are collected #then system files carry projection paths and bodies", async () => {
    const fixture = await createPalaceFixture()

    const core = await collectCore(fixture.repo, fixture.head)

    const persona = core.find((entry) => entry.path === "system/persona.md")
    expect(persona?.projection).toBe("$MEMORY_DIR/system/persona.md")
    expect(persona?.body).toContain("fixture persona")
    expect(persona?.description).toBe("who the agent is")
    expect(core.every((entry) => entry.path.startsWith("system/"))).toBe(true)
  }, 30_000)

  test("#given committed binary and text assets #when external entries are collected #then binaries report size only and never content", async () => {
    const fixture = await createPalaceFixture()

    const external = await collectExternal(fixture.repo, fixture.head)

    const binary = external.find((entry) => entry.path === "reference/logo.png")
    expect(binary?.binary).toBe(true)
    expect(binary?.byteSize).toBeGreaterThan(0)
    expect(binary?.body).toBeUndefined()
    const text = external.find((entry) => entry.path === "reference/notes.md")
    expect(text?.binary).toBe(false)
    expect(text?.body).toContain("external note")
  }, 30_000)

  test("#given a dirty working tree #when core entries are collected #then uncommitted files are labelled as absent from the system prompt", async () => {
    const fixture = await createPalaceFixture()
    await writePalaceWorkingFile(fixture, "system/draft.md", "---\ndescription: draft\n---\n\nnot committed yet\n")

    const core = await collectCore(fixture.repo, fixture.head)

    const draft = core.find((entry) => entry.path === "system/draft.md")
    expect(draft?.state).toBe("uncommitted - not active in system prompt")
    expect(core.find((entry) => entry.path === "system/persona.md")?.state).toBe("committed")
  }, 30_000)

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

  test("#given journal state and completion records #when reflection data is collected #then cursor state and recent outcomes are returned newest first", async () => {
    const fixture = await createPalaceFixture()
    await fixture.writeCompletion("run-old", { runId: "run-old", outcome: "merged", finishedAt: "2026-01-01T00:00:00.000Z" })
    await fixture.writeCompletion("run-new", { runId: "run-new", outcome: "failed", finishedAt: "2026-02-01T00:00:00.000Z" })

    const reflection = await collectReflection(fixture.paths, { limit: 5 })

    expect(reflection.cursor?.total_completed_steps).toBe(2)
    expect(reflection.cursor?.reflected_completed_steps).toBe(1)
    expect(reflection.outcomes.map((entry) => entry.runId)).toEqual(["run-new", "run-old"])
    expect(reflection.outcomes[0]?.outcome).toBe("failed")
  }, 30_000)

  test("#given more completion records than the limit #when reflection data is collected #then only the newest N are kept", async () => {
    const fixture = await createPalaceFixture()
    for (let index = 0; index < 5; index += 1) {
      await fixture.writeCompletion(`run-${index}`, {
        runId: `run-${index}`,
        outcome: "merged",
        finishedAt: `2026-03-0${index + 1}T00:00:00.000Z`,
      })
    }

    const reflection = await collectReflection(fixture.paths, { limit: 2 })

    expect(reflection.outcomes.map((entry) => entry.runId)).toEqual(["run-4", "run-3"])
  }, 30_000)
})
