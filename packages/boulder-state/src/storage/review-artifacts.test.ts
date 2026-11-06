import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

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
    expect(reviewsDir).toBe(resolve(directory, ".omo", "plans", "demo.reviews"))
  })

  test("keeps absolute plan paths rooted at their own location", () => {
    // given
    const directory = "/project"

    // when
    const reviewsDir = getPlanReviewsDir(directory, "/elsewhere/.omo/plans/demo.md")

    // then
    expect(reviewsDir).toBe(resolve("/elsewhere/.omo/plans/demo.reviews"))
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

describe("writeMomusReviewArtifact containment", () => {
  const baseArtifact = {
    verdict: "okay" as const,
    reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
    reviewerOutput: "**[OKAY]**",
  }

  test("refuses a plan path that escapes the plans directory with .. segments", () => {
    // given
    const directory = createTempProject()

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/../../escaped.md", baseArtifact)

      // then
      expect(written).toBeNull()
      expect(existsSync(join(directory, "escaped.reviews"))).toBe(false)
      expect(existsSync(join(directory, ".omo", "plans", "demo.reviews"))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("refuses an absolute plan path that belongs to another project", () => {
    // given
    const directory = createTempProject()
    const otherProject = createTempProject()

    try {
      // when
      const written = writeMomusReviewArtifact(
        directory,
        join(otherProject, ".omo", "plans", "demo.md"),
        baseArtifact,
      )

      // then
      expect(written).toBeNull()
      expect(existsSync(join(otherProject, ".omo", "plans", "demo.reviews"))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(otherProject, { recursive: true, force: true })
    }
  })

  test("refuses a plan file that is a symlink to a file outside the project", () => {
    // given
    const directory = createTempProject()
    const outsideDir = mkdtempSync(join(tmpdir(), "boulder-review-outside-"))
    const outsidePlan = join(outsideDir, "outside.md")
    writeFileSync(outsidePlan, "# Outside plan\n", "utf-8")
    symlinkSync(outsidePlan, join(directory, ".omo", "plans", "linked.md"))

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/linked.md", baseArtifact)

      // then
      expect(written).toBeNull()
      expect(existsSync(join(outsideDir, "outside.reviews"))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("refuses to write through a symlinked .reviews directory", () => {
    // given
    const directory = createTempProject()
    const outsideDir = mkdtempSync(join(tmpdir(), "boulder-review-outside-"))
    symlinkSync(outsideDir, join(directory, ".omo", "plans", "demo.reviews"), "dir")

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", baseArtifact)

      // then
      expect(written).toBeNull()
      expect(readdirSync(outsideDir)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("never writes through a symlinked artifact file", () => {
    // given
    const directory = createTempProject()
    const reviewsDir = join(directory, ".omo", "plans", "demo.reviews")
    mkdirSync(reviewsDir, { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), "boulder-review-outside-"))
    const outsideFile = join(outsideDir, "target.md")
    writeFileSync(outsideFile, "sentinel", "utf-8")
    symlinkSync(outsideFile, join(reviewsDir, "001-okay.md"))

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", baseArtifact)

      // then
      expect(written?.endsWith("002-okay.md")).toBe(true)
      expect(readFileSync(outsideFile, "utf-8")).toBe("sentinel")
      expect(readFileSync(join(reviewsDir, "002-okay.md"), "utf-8")).toContain("Verdict: okay")
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})

describe("writeMomusReviewArtifact plans root containment", () => {
  const baseArtifact = {
    verdict: "okay" as const,
    reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
    reviewerOutput: "**[OKAY]**",
  }

  test("refuses to write when .omo is a symlink to a directory outside the project", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-review-artifacts-"))
    const outsideDir = mkdtempSync(join(tmpdir(), "boulder-review-outside-"))
    mkdirSync(join(outsideDir, "plans"), { recursive: true })
    writeFileSync(join(outsideDir, "plans", "demo.md"), "# Demo plan\n", "utf-8")
    symlinkSync(outsideDir, join(directory, ".omo"), "dir")

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", baseArtifact)

      // then
      expect(written).toBeNull()
      expect(existsSync(join(outsideDir, "plans", "demo.reviews"))).toBe(false)
      expect(readdirSync(join(outsideDir, "plans"))).toEqual(["demo.md"])
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("refuses to write when .omo/plans is a symlink to a directory outside the project", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-review-artifacts-"))
    mkdirSync(join(directory, ".omo"), { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), "boulder-review-outside-"))
    const outsidePlans = join(outsideDir, "plans")
    mkdirSync(outsidePlans, { recursive: true })
    writeFileSync(join(outsidePlans, "demo.md"), "# Demo plan\n", "utf-8")
    symlinkSync(outsidePlans, join(directory, ".omo", "plans"), "dir")

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", baseArtifact)

      // then
      expect(written).toBeNull()
      expect(existsSync(join(outsidePlans, "demo.reviews"))).toBe(false)
      expect(readdirSync(outsidePlans)).toEqual(["demo.md"])
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})

describe("writeMomusReviewArtifact plans ignore file", () => {
  test("writes a .gitignore next to the plans that covers the .reviews directories", () => {
    // given
    const directory = createTempProject()

    try {
      // when
      const written = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        verdict: "okay",
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        reviewerOutput: "**[OKAY]**",
      })

      // then
      expect(written).not.toBeNull()
      const gitignore = readFileSync(join(directory, ".omo", "plans", ".gitignore"), "utf-8")
      expect(gitignore).toContain("*.reviews")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("keeps an existing plans .gitignore untouched", () => {
    // given
    const directory = createTempProject()
    const gitignorePath = join(directory, ".omo", "plans", ".gitignore")
    writeFileSync(gitignorePath, "custom-rule\n", "utf-8")

    try {
      // when
      writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        verdict: "okay",
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        reviewerOutput: "**[OKAY]**",
      })

      // then
      expect(readFileSync(gitignorePath, "utf-8")).toBe("custom-rule\n")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("writeMomusReviewArtifact deduplication", () => {
  test("returns the existing artifact when the same reviewer session is persisted twice", () => {
    // given
    const directory = createTempProject()
    const base = {
      verdict: "okay" as const,
      reviewerOutput: "**[OKAY]**",
      sessionId: "ses_review_1",
    }

    try {
      // when
      const first = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        ...base,
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
      })
      const second = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        ...base,
        reviewedAt: new Date("2026-04-01T01:00:00.000Z"),
      })
      const third = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        ...base,
        reviewedAt: new Date("2026-04-01T02:00:00.000Z"),
        sessionId: "ses_review_2",
      })

      // then
      expect(first?.endsWith("001-okay.md")).toBe(true)
      expect(second).toBe(first)
      expect(third?.endsWith("002-okay.md")).toBe(true)
      const entries = readdirSync(join(directory, ".omo", "plans", "demo.reviews")).sort()
      expect(entries).toEqual(["001-okay.md", "002-okay.md"])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not treat a session id that prefixes an earlier one as a duplicate", () => {
    // given
    const directory = createTempProject()
    const base = {
      verdict: "okay" as const,
      reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
      reviewerOutput: "**[OKAY]**",
    }

    try {
      // when
      const first = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        ...base,
        sessionId: "ses_review_1",
      })
      const second = writeMomusReviewArtifact(directory, ".omo/plans/demo.md", {
        ...base,
        sessionId: "ses_review",
      })

      // then
      expect(first?.endsWith("001-okay.md")).toBe(true)
      expect(second?.endsWith("002-okay.md")).toBe(true)
      const entries = readdirSync(join(directory, ".omo", "plans", "demo.reviews")).sort()
      expect(entries).toEqual(["001-okay.md", "002-okay.md"])
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
