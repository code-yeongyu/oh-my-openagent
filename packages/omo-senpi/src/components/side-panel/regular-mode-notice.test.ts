import { describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"

import { claimRegularModeNotice, REGULAR_MODE_NOTICE_MARKER } from "./regular-mode-notice"

describe("side panel regular-mode notice claim", () => {
  test("#given a fresh install state dir #when the notice is claimed #then exactly one claim wins and leaves the marker", () => {
    // given
    const dir = testTempDir("omo-10560-")

    // when / then
    expect(claimRegularModeNotice(dir)).toBe(true)
    expect(existsSync(join(dir, REGULAR_MODE_NOTICE_MARKER))).toBe(true)
    expect(claimRegularModeNotice(dir)).toBe(false)
  })

  test("#given a state dir that cannot be created #when the notice is claimed #then the claim fails closed", () => {
    // given: a path under a regular file can never hold the marker directory
    const base = testTempDir("omo-10560-")
    const file = join(base, "not-a-dir")
    writeFileSync(file, "x")

    // when / then
    expect(claimRegularModeNotice(join(file, "state"))).toBe(false)
  })
})
