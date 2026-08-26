import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { incrementMemoryUsage, readMemoryUsageLedger } from "./memory-usage-ledger"
import { fixture } from "./memory-usage.test-support"

describe("readMemoryUsageLedger", () => {
  test("#given a missing ledger file #when read #then returns empty object", async () => {
    const { paths } = await fixture()
    const ledger = await readMemoryUsageLedger(paths.ledgerPath)
    expect(ledger).toEqual({})
  })

  test("#given a ledger with valid entries #when read #then returns parsed entries", async () => {
    const { paths } = await fixture()
    await writeFile(
      paths.ledgerPath,
      JSON.stringify({ "reference/project/foo.md": { count: 3, lastUsedAt: "2026-01-15T10:00:00Z" } }),
      "utf8",
    )
    const ledger = await readMemoryUsageLedger(paths.ledgerPath)
    expect(ledger["reference/project/foo.md"]).toEqual({ count: 3, lastUsedAt: "2026-01-15T10:00:00Z" })
  })

  test("#given a corrupted ledger file #when read #then returns empty object", async () => {
    const { paths } = await fixture()
    await writeFile(paths.ledgerPath, "not json {{{", "utf8")
    const ledger = await readMemoryUsageLedger(paths.ledgerPath)
    expect(ledger).toEqual({})
  })
})

describe("incrementMemoryUsage", () => {
  test("#given a missing ledger #when increment a path #then count is 1 and lastUsedAt is set", async () => {
    const { paths } = await fixture()
    await incrementMemoryUsage(paths, "reference/project/foo.md", () => new Date("2026-01-15T10:00:00Z"))
    const ledger = await readMemoryUsageLedger(paths.ledgerPath)
    expect(ledger["reference/project/foo.md"]).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given an existing entry #when increment again #then count is 2 and lastUsedAt updates", async () => {
    const { paths } = await fixture()
    await incrementMemoryUsage(paths, "reference/project/foo.md", () => new Date("2026-01-15T10:00:00Z"))
    await incrementMemoryUsage(paths, "reference/project/foo.md", () => new Date("2026-01-16T12:00:00Z"))
    const ledger = await readMemoryUsageLedger(paths.ledgerPath)
    expect(ledger["reference/project/foo.md"]).toEqual({ count: 2, lastUsedAt: "2026-01-16T12:00:00.000Z" })
  })
})
