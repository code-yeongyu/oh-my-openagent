import { describe, expect, test } from "bun:test"

import { memorySettings } from "./memory.test-support"
import { projectionLimits } from "./projection-limits"

describe("projectionLimits", () => {
  test("#given a per-agent override of one key #when resolved #then that agent gets the override and keeps the other base key", () => {
    // given
    const settings = memorySettings({
      projection: { max_entries_per_directory: 40, max_bytes: 8000 },
      agents: { scout: { projection: { max_entries_per_directory: 5 } } },
    })

    // when
    const scout = projectionLimits(settings, "scout")
    const other = projectionLimits(settings, "builder")

    // then
    expect(scout).toEqual({ maxEntriesPerDirectory: 5, maxBytes: 8000 })
    expect(other).toEqual({ maxEntriesPerDirectory: 40, maxBytes: 8000 })
  })
})
