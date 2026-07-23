/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureNotepadScaffold } from "./notepad-scaffold"

describe("ensureNotepadScaffold", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `notepad-scaffold-${randomUUID()}`)
    mkdirSync(testDirectory, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("#given fresh temp dir #when ensureNotepadScaffold called #then creates all 4 notepad files with headers", () => {
    // given
    const directory = testDirectory

    // when
    const result = ensureNotepadScaffold({
      directory,
      planName: "alpha",
      timestamp: "2026-01-01T00:00:00Z",
    })

    // then
    const notepadDir = join(directory, ".omo", "notepads", "alpha")

    expect(existsSync(join(notepadDir, "learnings.md"))).toBe(true)
    expect(existsSync(join(notepadDir, "decisions.md"))).toBe(true)
    expect(existsSync(join(notepadDir, "issues.md"))).toBe(true)
    expect(existsSync(join(notepadDir, "problems.md"))).toBe(true)

    const learnings = readFileSync(join(notepadDir, "learnings.md"), "utf8")
    const decisions = readFileSync(join(notepadDir, "decisions.md"), "utf8")
    const issues = readFileSync(join(notepadDir, "issues.md"), "utf8")
    const problems = readFileSync(join(notepadDir, "problems.md"), "utf8")

    expect(learnings).toContain("# Learnings \u2014 alpha")
    expect(decisions).toContain("# Decisions \u2014 alpha")
    expect(issues).toContain("# Issues \u2014 alpha")
    expect(problems).toContain("# Problems \u2014 alpha")

    expect(learnings).toContain("Auto-scaffolded by /start-work")
    expect(decisions).toContain("Auto-scaffolded by /start-work")
    expect(issues).toContain("Auto-scaffolded by /start-work")
    expect(problems).toContain("Auto-scaffolded by /start-work")

    expect(result.created).toContain("learnings.md")
    expect(result.created).toContain("decisions.md")
    expect(result.created).toContain("issues.md")
    expect(result.created).toContain("problems.md")
  })

  test("#given already-scaffolded dir #when called again #then all 4 files unchanged (idempotent)", () => {
    // given
    const directory = testDirectory

    // when
    ensureNotepadScaffold({
      directory,
      planName: "alpha",
      timestamp: "2026-01-01T00:00:00Z",
    })

    const notepadDir = join(directory, ".omo", "notepads", "alpha")
    const learningsBefore = readFileSync(join(notepadDir, "learnings.md"), "utf8")
    const decisionsBefore = readFileSync(join(notepadDir, "decisions.md"), "utf8")
    const issuesBefore = readFileSync(join(notepadDir, "issues.md"), "utf8")
    const problemsBefore = readFileSync(join(notepadDir, "problems.md"), "utf8")

    const result = ensureNotepadScaffold({
      directory,
      planName: "alpha",
      timestamp: "2026-01-01T00:00:00Z",
    })

    // then
    const learningsAfter = readFileSync(join(notepadDir, "learnings.md"), "utf8")
    const decisionsAfter = readFileSync(join(notepadDir, "decisions.md"), "utf8")
    const issuesAfter = readFileSync(join(notepadDir, "issues.md"), "utf8")
    const problemsAfter = readFileSync(join(notepadDir, "problems.md"), "utf8")

    expect(learningsAfter).toBe(learningsBefore)
    expect(decisionsAfter).toBe(decisionsBefore)
    expect(issuesAfter).toBe(issuesBefore)
    expect(problemsAfter).toBe(problemsBefore)

    expect(result.created).toEqual([])
    expect(result.skipped).toContain("learnings.md")
    expect(result.skipped).toContain("decisions.md")
    expect(result.skipped).toContain("issues.md")
    expect(result.skipped).toContain("problems.md")
  })

  test("#given dir with learnings.md and decisions.md pre-existing #when called #then creates only issues.md and problems.md; leaves pre-existing untouched", () => {
    // given
    const directory = testDirectory
    const notepadDir = join(directory, ".omo", "notepads", "alpha")
    mkdirSync(notepadDir, { recursive: true })
    writeFileSync(join(notepadDir, "learnings.md"), "ORIGINAL LEARNINGS")
    writeFileSync(join(notepadDir, "decisions.md"), "ORIGINAL DECISIONS")

    // when
    const result = ensureNotepadScaffold({
      directory,
      planName: "alpha",
      timestamp: "2026-01-01T00:00:00Z",
    })

    // then
    const learnings = readFileSync(join(notepadDir, "learnings.md"), "utf8")
    const decisions = readFileSync(join(notepadDir, "decisions.md"), "utf8")

    expect(learnings).toBe("ORIGINAL LEARNINGS")
    expect(decisions).toBe("ORIGINAL DECISIONS")

    expect(existsSync(join(notepadDir, "issues.md"))).toBe(true)
    expect(existsSync(join(notepadDir, "problems.md"))).toBe(true)

    const issues = readFileSync(join(notepadDir, "issues.md"), "utf8")
    const problems = readFileSync(join(notepadDir, "problems.md"), "utf8")

    expect(issues).toContain("# Issues \u2014 alpha")
    expect(problems).toContain("# Problems \u2014 alpha")

    expect(result.created).toEqual(["issues.md", "problems.md"])
    expect(result.skipped).toEqual(["learnings.md", "decisions.md"])
  })

  test("#given nested missing parent dirs #when called #then creates full .omo/notepads/alpha path", () => {
    // given
    const directory = testDirectory
    // do NOT pre-create .omo/

    // when
    ensureNotepadScaffold({
      directory,
      planName: "alpha",
      timestamp: "2026-01-01T00:00:00Z",
    })

    // then
    expect(existsSync(join(directory, ".omo", "notepads", "alpha"))).toBe(true)
    expect(existsSync(join(directory, ".omo", "notepads", "alpha", "learnings.md"))).toBe(true)
    expect(existsSync(join(directory, ".omo", "notepads", "alpha", "decisions.md"))).toBe(true)
    expect(existsSync(join(directory, ".omo", "notepads", "alpha", "issues.md"))).toBe(true)
    expect(existsSync(join(directory, ".omo", "notepads", "alpha", "problems.md"))).toBe(true)
  })
})
