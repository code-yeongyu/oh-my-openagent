import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readSkillsUsageLedger } from "./skills-usage-ledger"
import { SkillsUsageTracker } from "./skills-usage-tracker"
import { fixture } from "./skills-usage.test-support"

describe("SkillsUsageTracker", () => {
  test("#given a read of skills/foo/SKILL.md #when recordRead is called then flushed #then foo.count is 1", async () => {
    // #given
    const { repoDir, paths } = await fixture()
    const tracker = new SkillsUsageTracker({
      paths,
      repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    await tracker.flush()

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given a non-skill read #when recordRead is called then flushed #then ledger is empty", async () => {
    // #given
    const { repoDir, paths } = await fixture()
    const tracker = new SkillsUsageTracker({
      paths,
      repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    tracker.recordRead(join(repoDir, "notes", "facts.md"))
    await tracker.flush()

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given multiple reads of the same skill before flush #when flushed #then count reflects all reads", async () => {
    // #given
    const { repoDir, paths } = await fixture()
    const tracker = new SkillsUsageTracker({
      paths,
      repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    await tracker.flush()

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo?.count).toBe(3)
  })

  test("#given reads of multiple skills #when flushed #then all skills are present", async () => {
    // #given
    const { repoDir, paths } = await fixture()
    const tracker = new SkillsUsageTracker({
      paths,
      repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    tracker.recordRead(join(repoDir, "skills", "bar", "SKILL.md"))
    tracker.recordRead(join(repoDir, "skills", "foo", "SKILL.md"))
    await tracker.flush()

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo?.count).toBe(2)
    expect(ledger.bar?.count).toBe(1)
  })
})
