import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { incrementSkillUsage, readSkillsUsageLedger } from "./skills-usage-ledger"
import { fixture } from "./skills-usage.test-support"

describe("readSkillsUsageLedger", () => {
  test("#given a missing ledger file #when read #then returns empty object", async () => {
    // #given
    const { paths } = await fixture()

    // #when
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)

    // #then
    expect(ledger).toEqual({})
  })

  test("#given a ledger with valid entries #when read #then returns parsed entries", async () => {
    // #given
    const { paths } = await fixture()
    await writeFile(
      paths.ledgerPath,
      JSON.stringify({ foo: { count: 3, lastUsedAt: "2026-01-15T10:00:00Z" } }),
      "utf8",
    )

    // #when
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)

    // #then
    expect(ledger).toEqual({ foo: { count: 3, lastUsedAt: "2026-01-15T10:00:00Z" } })
  })

  test("#given a corrupted ledger file #when read #then returns empty object (write never blocks or fails the tool)", async () => {
    // #given
    const { paths } = await fixture()
    await writeFile(paths.ledgerPath, "not json {{{", "utf8")

    // #when
    const ledger = await readSkillsUsageLedger(paths.ledgerPath)

    // #then
    expect(ledger).toEqual({})
  })
})
