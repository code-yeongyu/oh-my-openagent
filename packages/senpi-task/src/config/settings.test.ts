import { availableParallelism } from "node:os"
import { describe, expect, test } from "bun:test"

import { resolveOmoTaskSettings } from "@oh-my-opencode/omo-config-core"

describe("task settings", () => {
  test("#given no residency override #when settings parse #then defaults residency cap to max of eight and cpu times three", () => {
    // given
    const expected = Math.max(8, availableParallelism() * 3)

    // when
    const settings = resolveOmoTaskSettings({})
    const twoCpuSettings = resolveOmoTaskSettings({}, () => 2)
    const fourCpuSettings = resolveOmoTaskSettings({}, () => 4)

    // then
    expect(settings.residency_max_children).toBe(expected)
    expect(twoCpuSettings.residency_max_children).toBe(8)
    expect(fourCpuSettings.residency_max_children).toBe(12)
  })
})
