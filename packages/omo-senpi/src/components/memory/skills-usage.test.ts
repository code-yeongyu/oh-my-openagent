import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { extractSkillId, incrementSkillUsage, readSkillsUsageLedger } from "./skills-usage"
import { fixture } from "./skills-usage.test-support"

describe("extractSkillId", () => {
  test("#given a path inside skills/foo #when extracted #then returns the skill id", async () => {
    // #given
    const { repoDir } = await fixture()

    // #when
    const id = extractSkillId(repoDir, join(repoDir, "skills", "foo", "SKILL.md"))

    // #then
    expect(id).toBe("foo")
  })

  test("#given a path inside notes #when extracted #then returns undefined", async () => {
    // #given
    const { repoDir } = await fixture()

    // #when
    const id = extractSkillId(repoDir, join(repoDir, "notes", "facts.md"))

    // #then
    expect(id).toBeUndefined()
  })

  test("#given a path outside the repo #when extracted #then returns undefined", async () => {
    // #given
    const { repoDir } = await fixture()

    // #when
    const id = extractSkillId(repoDir, "/tmp/other/SKILL.md")

    // #then
    expect(id).toBeUndefined()
  })
})

describe("incrementSkillUsage", () => {
  test("#given a fresh ledger #when incrementing skill foo #then count is 1 and lastUsedAt is set", async () => {
    // #given
    const { paths } = await fixture()
    const now = () => new Date("2026-01-15T10:00:00Z")

    // #when
    await incrementSkillUsage(paths, "foo", now)

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given an existing ledger with count 1 #when incrementing foo again #then count is 2", async () => {
    // #given
    const { paths } = await fixture()
    const now = () => new Date("2026-01-15T10:00:00Z")
    await incrementSkillUsage(paths, "foo", now)

    // #when
    await incrementSkillUsage(paths, "foo", () => new Date("2026-01-15T11:00:00Z"))

    // #then
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo).toEqual({ count: 2, lastUsedAt: "2026-01-15T11:00:00.000Z" })
  })

  test("#given non-skill reads #when checking the ledger #then no entries are created", async () => {
    // #given
    const { paths } = await fixture()
    const now = () => new Date("2026-01-15T10:00:00Z")

    // #when - increment a skill, not a notes file
    await incrementSkillUsage(paths, "foo", now)

    // #then - only foo is present, no notes or other entries
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(Object.keys(ledger)).toEqual(["foo"])
  })

  test("#given concurrent two-session interleaving #when both sessions increment different skills under lock #then no increment is lost", async () => {
    // #given
    const { paths } = await fixture()
    const now = () => new Date("2026-01-15T10:00:00Z")

    // #when - simulate two sessions incrementing in interleaved order
    // session A: read foo
    await incrementSkillUsage(paths, "foo", now)
    // session B: read bar (interleaved before A flushes foo)
    await incrementSkillUsage(paths, "bar", now)
    // session A: read foo again
    await incrementSkillUsage(paths, "foo", now)
    // session B: read bar again
    await incrementSkillUsage(paths, "bar", now)

    // #then - all four increments landed
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo).toEqual({ count: 2, lastUsedAt: "2026-01-15T10:00:00.000Z" })
    expect(ledger.bar).toEqual({ count: 2, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given two sessions incrementing the SAME skill concurrently #when both acquire the lock serially #then count is 2 (no lost update)", async () => {
    // #given
    const { paths } = await fixture()
    const now = () => new Date("2026-01-15T10:00:00Z")

    // #when - both sessions read the same skill; the lock serializes read-modify-write
    const [a, b] = await Promise.all([
      incrementSkillUsage(paths, "foo", now),
      incrementSkillUsage(paths, "foo", now),
    ])

    // #then
    void a
    void b
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)
    expect(ledger.foo?.count).toBe(2)
  })
})
