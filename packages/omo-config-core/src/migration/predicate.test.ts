import { describe, expect, test } from "bun:test"
import { shouldRunMigration } from "../index"

describe("shouldRunMigration", () => {
  test("#given no legacy sources #when evaluating a target without a marker #then migration is not triggered", () => {
    // given
    const input = { legacySourcesExist: false, migrationId: "legacy-a", target: {} }

    // when
    const result = shouldRunMigration(input)

    // then
    expect(result).toBe(false)
  })

  test("#given a target marker for this migration #when legacy sources exist #then migration is not triggered", () => {
    // given
    const input = { legacySourcesExist: true, migrationId: "legacy-a", target: { _migrations: ["legacy-a"] } }

    // when
    const result = shouldRunMigration(input)

    // then
    expect(result).toBe(false)
  })

  test("#given legacy sources and no target marker #when evaluating a distinct target migration pair #then migration is triggered", () => {
    // given
    const input = { legacySourcesExist: true, migrationId: "legacy-b", target: { _migrations: ["legacy-a"] } }

    // when
    const result = shouldRunMigration(input)

    // then
    expect(result).toBe(true)
  })
})
