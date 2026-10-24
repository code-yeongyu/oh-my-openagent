import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  formatMomusReviewArtifact,
  getPlanReviewsDir,
  hashPlanContent,
  writeMomusReviewArtifact,
} from "./review-artifacts"

function createTempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-review-artifacts-"))
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  writeFileSync(join(directory, ".omo", "plans", "demo.md"), "# Demo plan\n", "utf-8")
  return directory
}

describe("getPlanReviewsDir", () => {
  test("resolves a sibling .reviews directory for a relative plan path", () => {
    // given
    const directory = "/project"

    // when
    const reviewsDir = getPlanReviewsDir(directory, ".omo/plans/demo.md")

    // then
    expect(reviewsDir).toBe(join(directory, ".omo", "plans", "demo.reviews"))
  })

  test("keeps absolute plan paths rooted at their own location", () => {
    // given
    const directory = "/project"

    // when
    const reviewsDir = getPlanReviewsDir(directory, "/elsewhere/.omo/plans/demo.md")

    // then
    expect(reviewsDir).toBe("/elsewhere/.omo/plans/demo.reviews")
  })
})

describe("hashPlanContent", () => {
  test("produces a stable sha256 hex digest", () => {
    // given
    const content = "# Demo plan\n"

    // when
    const first = hashPlanContent(content)
    const second = hashPlanContent(content)

    // then
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  test("changes when the plan content changes", () => {
    // given
    const before = hashPlanContent("# Demo plan\n")

    // when
    const after = hashPlanContent("# Demo plan\n- [ ] new todo\n")

    // then
    expect(after).not.toBe(before)
  })
})

describe("writeMomusReviewArtifact", () => {
  test("writes 001-reject.md for the first review of a plan", () => {
    // given
    const directory = createTempProject()

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        verdict: "reject",
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        model: "anthropic/claude-opus-4-6",
        planHash: hashPlanContent("# Demo plan\n"),
        durationMs: 95_000,
        reviewerOutput: "**[REJECT]**\n\n**Summary**: Reference on line 12 does not exist.",
      })

      // then
      expect(written).not.toBeNull()
      expect(written?.endsWith(join("demo.reviews", "001-reject.md"))).toBe(true)
      const content = readFileSync(written as string, "utf-8")
      expect(content).toContain("Verdict: reject")
      expect(content).toContain("Reviewed at: 2026-04-01T00:00:00.000Z")
      expect(content).toContain("Model: anthropic/claude-opus-4-6")
      expect(content).toContain("Duration: 95.0s")
      expect(content).toContain("**[REJECT]**")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("increments the sequence across reviews of the same plan", () => {
    // given
    const directory = createTempProject()

    try {
      const base = {
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        reviewerOutput: "**[OKAY]**",
      }

      // when
      const first = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", { ...base, verdict: "reject" })
      const second = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", { ...base, verdict: "okay" })

      // then
      expect(first?.endsWith("001-reject.md")).toBe(true)
      expect(second?.endsWith("002-okay.md")).toBe(true)
      const entries = readdirSync(join(directory, ".omo", "plans", "demo.reviews")).sort()
      expect(entries).toEqual(["001-reject.md", "002-okay.md"])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("ignores unrelated files when picking the next sequence", () => {
    // given
    const directory = createTempProject()
    const reviewsDir = join(directory, ".omo", "plans", "demo.reviews")
    mkdirSync(reviewsDir, { recursive: true })
    writeFileSync(join(reviewsDir, "notes.txt"), "not a review", "utf-8")
    writeFileSync(join(reviewsDir, "007-okay.md"), "older review", "utf-8")

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        verdict: "okay",
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        reviewerOutput: "**[OKAY]**",
      })

      // then
      expect(written?.endsWith("008-okay.md")).toBe(true)
      expect(existsSync(join(reviewsDir, "008-okay.md"))).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("formatMomusReviewArtifact", () => {
  test("marks missing model, hash, and duration as unknown or unavailable", () => {
    // given
    const artifact = {
      verdict: "okay" as const,
      reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
      reviewerOutput: "**[OKAY]**",
    }

    // when
    const content = formatMomusReviewArtifact({ sequence: 3, planPath: ".omo/plans/demo.md", artifact })

    // then
    expect(content).toContain("# Momus review 003: OKAY")
    expect(content).toContain("Model: unknown")
    expect(content).toContain("Plan hash (sha256): unavailable")
    expect(content).toContain("Duration: unknown")
  })
})
